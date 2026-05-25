"use strict";
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = require("../config/prisma");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashResetToken,
} = require("../utils/jwt");
const { config } = require("../config/env");
const { getEffectivePermissions, invalidateCache } = require("../services/permissionService");
const { sendSMS } = require("../services/smsService");

const LOGIN_MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES    = 15;

// ── helpers ──────────────────────────────────────────────────────────────────

async function buildUserResponse(user) {
  const userRoles = await prisma.userRole.findMany({
    where: { userId: user.id },
    include: { role: true },
  });
  const roles = [...new Set(userRoles.map(ur => ur.role.name))];
  const permSet = await getEffectivePermissions(user.id, "global");

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? undefined,
    roles,
    activeRole: user.activeRole,
    isEmployee: user.isEmployee,
    permissions: Array.from(permSet),
    homeLocation: user.homeLocation ?? undefined,
    employeeId: user.employeeId,
    status: user.status,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
  };
}

function buildTokenPayload(user) {
  return { sub: user.id, email: user.email, activeRole: user.activeRole };
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Generate a cryptographically random 6-digit OTP string. */
function generateOTP() {
  // Uniform distribution: draw until we get a value < 1_000_000
  let n;
  do { n = crypto.randomBytes(4).readUInt32BE(0); } while (n >= 4_000_000_000);
  return String(n % 1_000_000).padStart(6, "0");
}

function setRefreshCookie(res, token) {
  res.cookie("refresh_token", token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: config.isProd ? "strict" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/api/v1/auth",
  });
}

function clearRefreshCookie(res) {
  res.clearCookie("refresh_token", { path: "/api/v1/auth" });
}

async function issueRefreshToken(userId, req) {
  const raw = generateRefreshToken({ sub: userId });
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] || "",
    },
  });
  return raw;
}

async function writeAudit(userId, action, subject, detail, req) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        subject,
        detail,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] || "",
      },
    });
  } catch { /* non-critical */ }
}

// ── Session anomaly detection ─────────────────────────────────────────────────
// After issuing a new session, check if the login IP differs from the most
// recent previous session. If so, send an SMS warning to the user.

async function detectSessionAnomaly(userId, currentIP, req) {
  if (!currentIP) return;

  // The two most recent tokens: [0] = just created, [1] = previous
  const recent = await prisma.refreshToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 2,
  });

  const previous = recent[1];
  if (!previous || !previous.ipAddress || previous.ipAddress === currentIP) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, email: true },
  });

  const msg = `ISMS Security: New login to your account from ${currentIP}. Previous session was from ${previous.ipAddress}. If this wasn't you, change your password immediately.`;

  if (user?.phone) {
    await sendSMS(user.phone, msg);
  }

  await writeAudit(userId, "auth.session.anomaly", "security",
    `New IP login: ${currentIP} (previous: ${previous.ipAddress})`, req);
}

// ── Account lockout helpers ───────────────────────────────────────────────────

async function notifyAdminsOfLockout(email, ip) {
  const admins = await prisma.user.findMany({
    where: {
      status: "Active",
      userRoles: { some: { role: { name: "Admin" } } },
    },
    select: { phone: true },
  });

  const phones = admins.map(a => a.phone).filter(Boolean);
  if (phones.length === 0) return;

  await sendSMS(phones,
    `ISMS Security Alert: Account ${email} locked after ${LOGIN_MAX_ATTEMPTS} failed login attempts from IP ${ip}.`
  );
}

// ── controllers ──────────────────────────────────────────────────────────────

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Generic message — don't reveal whether email exists
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    // ── Lockout check ────────────────────────────────────────────────────────
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      return res.status(423).json({
        success: false,
        message: `Account temporarily locked. Try again in ${minutesLeft} minute(s).`,
        code: "ACCOUNT_LOCKED",
      });
    }

    if (user.status !== "Active") {
      return res.status(403).json({
        success: false,
        message: `Account is ${user.status.toLowerCase()}. Contact your administrator.`,
      });
    }

    // ── Password check ───────────────────────────────────────────────────────
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      const attempts = user.loginAttempts + 1;
      const reachedLimit = attempts >= LOGIN_MAX_ATTEMPTS;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          loginAttempts: reachedLimit ? 0 : attempts,
          lockedUntil: reachedLimit
            ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
            : null,
        },
      });

      await writeAudit(user.id, "auth.login.failed", user.email,
        `Failed login attempt ${attempts}${reachedLimit ? " — account locked" : ""}`, req);

      if (reachedLimit) {
        // Fire-and-forget — don't delay the 401 response
        notifyAdminsOfLockout(user.email, req.ip).catch(() => {});
        return res.status(423).json({
          success: false,
          message: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
          code: "ACCOUNT_LOCKED",
        });
      }

      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    // ── Successful login ─────────────────────────────────────────────────────
    const accessToken = generateAccessToken(buildTokenPayload(user));
    const rawRefresh  = await issueRefreshToken(user.id, req);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date(), loginAttempts: 0, lockedUntil: null },
    });

    // Session anomaly detection — async, non-blocking
    detectSessionAnomaly(user.id, req.ip, req).catch(() => {});

    setRefreshCookie(res, rawRefresh);
    await writeAudit(user.id, "auth.login", user.email, "Successful login", req);

    res.json({
      success: true,
      message: "Login successful",
      data: { accessToken, user: await buildUserResponse(user) },
    });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const userId    = req.user?.sub;
    const rawToken  = req.cookies?.refresh_token;

    if (userId) {
      if (rawToken) {
        await prisma.refreshToken.updateMany({
          where: { userId, tokenHash: hashToken(rawToken), revoked: false },
          data: { revoked: true },
        });
      } else {
        await prisma.refreshToken.updateMany({
          where: { userId, revoked: false },
          data: { revoked: true },
        });
      }
      invalidateCache(userId);
      await writeAudit(userId, "auth.logout", "session", "User logged out", req);
    }

    clearRefreshCookie(res);
    res.json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) {
      return res.status(401).json({
        success: false, message: "Refresh token not found", code: "NO_REFRESH_TOKEN",
      });
    }

    const incomingHash = hashToken(rawToken);
    const existingRecord = await prisma.refreshToken.findUnique({ where: { tokenHash: incomingHash } });

    if (existingRecord?.revoked) {
      // Token reuse — revoke all sessions
      await prisma.refreshToken.updateMany({
        where: { userId: existingRecord.userId },
        data: { revoked: true },
      });
      clearRefreshCookie(res);
      await writeAudit(existingRecord.userId, "auth.refresh.reuse", "security",
        "Refresh token reuse detected — all sessions revoked", req);
      return res.status(401).json({
        success: false, message: "Token reuse detected. Please log in again.", code: "TOKEN_REUSE",
      });
    }

    if (!existingRecord || existingRecord.expiresAt < new Date()) {
      clearRefreshCookie(res);
      return res.status(401).json({
        success: false, message: "Invalid or expired refresh token", code: "INVALID_REFRESH_TOKEN",
      });
    }

    try { verifyRefreshToken(rawToken); } catch {
      clearRefreshCookie(res);
      return res.status(401).json({
        success: false, message: "Invalid or expired refresh token", code: "INVALID_REFRESH_TOKEN",
      });
    }

    const user = await prisma.user.findUnique({ where: { id: existingRecord.userId } });
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: "User not found", code: "USER_NOT_FOUND" });
    }
    if (user.status !== "Active") {
      clearRefreshCookie(res);
      return res.status(403).json({ success: false, message: "Account is no longer active" });
    }

    // Rotate token
    await prisma.refreshToken.update({ where: { id: existingRecord.id }, data: { revoked: true } });
    const newAccessToken = generateAccessToken(buildTokenPayload(user));
    const newRawRefresh  = await issueRefreshToken(user.id, req);
    setRefreshCookie(res, newRawRefresh);

    res.json({ success: true, data: { accessToken: newAccessToken } });
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, data: { user: await buildUserResponse(user) } });
  } catch (err) {
    next(err);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { name, phone } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user.sub },
      data: { name: name || undefined, phone: phone || undefined },
    });
    await writeAudit(user.id, "auth.profile.update", "profile", "Profile updated", req);
    res.json({ success: true, message: "Profile updated", data: { user: await buildUserResponse(user) } });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.status(400).json({ success: false, message: "Current password is incorrect" });
    }

    const hashed = await bcrypt.hash(newPassword, config.bcryptRounds);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revoked: false }, data: { revoked: true } });

    invalidateCache(user.id);
    clearRefreshCookie(res);
    await writeAudit(user.id, "auth.password.change", "password", "Password changed — all sessions invalidated", req);

    res.json({ success: true, message: "Password changed. Please log in again." });
  } catch (err) {
    next(err);
  }
}

// ── OTP Password Reset ────────────────────────────────────────────────────────
// Spec §20.1: 6-digit OTP, 10-minute expiry, single-use, sent via Africa's Talking SMS.

async function requestPasswordReset(req, res, next) {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      const otp     = generateOTP();
      const expiry  = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken: hashResetToken(otp), resetTokenExpiry: expiry },
      });

      await writeAudit(user.id, "auth.password.reset.request", email, "Password reset OTP requested", req);

      const smsResult = await sendSMS(
        user.phone,
        `Your ISMS password reset code is: ${otp}. It expires in 10 minutes. Do not share it.`,
      );

      if (config.isDev) {
        return res.json({
          success: true,
          message: "Password reset OTP sent",
          dev_otp: otp,
          dev_sms: smsResult,
        });
      }
    }

    // Same response whether the email exists or not — prevents enumeration
    res.json({ success: true, message: "If an account with that email exists, a reset code has been sent to the registered phone number." });
  } catch (err) {
    next(err);
  }
}

async function confirmPasswordReset(req, res, next) {
  try {
    const { token, password } = req.body;

    const user = await prisma.user.findFirst({
      where: {
        resetToken:     hashResetToken(token),
        resetTokenExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid or expired reset code" });
    }

    const hashed = await bcrypt.hash(password, config.bcryptRounds);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, resetToken: null, resetTokenExpiry: null },
    });

    await prisma.refreshToken.updateMany({ where: { userId: user.id, revoked: false }, data: { revoked: true } });

    invalidateCache(user.id);
    clearRefreshCookie(res);
    await writeAudit(user.id, "auth.password.reset", "password", "Password reset successfully", req);

    res.json({ success: true, message: "Password reset successfully. Please log in." });
  } catch (err) {
    next(err);
  }
}

async function switchRole(req, res, next) {
  try {
    const { role }  = req.body;
    const userId    = req.user.sub;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const roleRecord = await prisma.role.findUnique({ where: { name: role } });
    if (!roleRecord) {
      return res.status(400).json({ success: false, message: `Role "${role}" does not exist` });
    }

    const userRole = await prisma.userRole.findFirst({ where: { userId, roleId: roleRecord.id } });
    if (!userRole) {
      return res.status(403).json({ success: false, message: `You do not have the ${role} role` });
    }

    const updated = await prisma.user.update({ where: { id: userId }, data: { activeRole: role } });
    invalidateCache(userId);

    const newAccessToken = generateAccessToken(buildTokenPayload(updated));
    await writeAudit(userId, "auth.role.switch", role, `Switched from ${user.activeRole} to ${role}`, req);

    res.json({
      success: true,
      message: `Switched to ${role}`,
      data: { accessToken: newAccessToken, user: await buildUserResponse(updated) },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  login,
  logout,
  refresh,
  getMe,
  updateProfile,
  changePassword,
  requestPasswordReset,
  confirmPasswordReset,
  switchRole,
};
