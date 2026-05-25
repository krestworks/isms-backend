"use strict";
const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");
const { config } = require("../config/env");
const { getEffectivePermissions, invalidateCache } = require("../services/permissionService");

const VALID_ROLES = ["Admin", "Manager", "LocationHead", "Accountant", "Attendant", "Employee"];
const VALID_STATUSES = ["Active", "Inactive", "Suspended"];

async function buildUserSummary(user) {
  const userRoles = await prisma.userRole.findMany({
    where: { userId: user.id },
    include: { role: true },
  });
  const roles = [...new Set(userRoles.map(ur => ur.role.name))];
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? undefined,
    employeeId: user.employeeId ?? undefined,
    activeRole: user.activeRole,
    isEmployee: user.isEmployee,
    homeLocation: user.homeLocation ?? undefined,
    status: user.status,
    roles,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
  };
}

// ── GET /users ────────────────────────────────────────────────────────────────

async function listUsers(req, res, next) {
  try {
    const { status, role, page = "1", limit = "25" } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    const where = {};
    if (status) where.status = status;
    if (role) {
      where.userRoles = { some: { role: { name: role } } };
    }

    const [users, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.user.count({ where }),
    ]);

    const data = await Promise.all(users.map(buildUserSummary));

    res.json({
      success: true,
      data,
      meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /users ───────────────────────────────────────────────────────────────

async function createUser(req, res, next) {
  try {
    const { email, password, name, phone, employeeId, activeRole = "Employee", homeLocation, isEmployee = false, roles = [] } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ success: false, message: "A user with this email already exists" });
    }

    const defaultRole = activeRole || "Employee";
    if (!VALID_ROLES.includes(defaultRole)) {
      return res.status(422).json({ success: false, message: `Invalid activeRole: ${defaultRole}` });
    }

    const hashed = await bcrypt.hash(password, config.bcryptRounds);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        name,
        phone: phone || undefined,
        employeeId: employeeId || undefined,
        activeRole: defaultRole,
        homeLocation: homeLocation || undefined,
        isEmployee,
        status: "Active",
      },
    });

    // Assign roles
    const roleNames = roles.length > 0 ? roles : [defaultRole];
    for (const roleName of roleNames) {
      if (!VALID_ROLES.includes(roleName)) continue;
      const roleRecord = await prisma.role.findUnique({ where: { name: roleName } });
      if (!roleRecord) continue;
      await prisma.userRole.upsert({
        where: { userId_roleId_stationId: { userId: user.id, roleId: roleRecord.id, stationId: "global" } },
        update: {},
        create: { userId: user.id, roleId: roleRecord.id, stationId: "global" },
      });
    }

    // Always ensure the base Employee role is assigned
    if (!roleNames.includes("Employee")) {
      const empRole = await prisma.role.findUnique({ where: { name: "Employee" } });
      if (empRole) {
        await prisma.userRole.upsert({
          where: { userId_roleId_stationId: { userId: user.id, roleId: empRole.id, stationId: "global" } },
          update: {},
          create: { userId: user.id, roleId: empRole.id, stationId: "global" },
        });
      }
    }

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: await buildUserSummary(user),
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /users/:id ────────────────────────────────────────────────────────────

async function getUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const permCodes = await getEffectivePermissions(user.id, "global");
    const summary = await buildUserSummary(user);

    res.json({
      success: true,
      data: { ...summary, permissions: Array.from(permCodes) },
    });
  } catch (err) {
    next(err);
  }
}

// ── PUT /users/:id/roles ──────────────────────────────────────────────────────
// Body: { roles: string[] }  — replaces all role assignments globally

async function assignRoles(req, res, next) {
  try {
    const { id } = req.params;
    const { roles } = req.body;

    if (!Array.isArray(roles) || roles.length === 0) {
      return res.status(422).json({ success: false, message: "roles must be a non-empty array" });
    }

    const invalid = roles.filter(r => !VALID_ROLES.includes(r));
    if (invalid.length > 0) {
      return res.status(422).json({ success: false, message: `Invalid roles: ${invalid.join(", ")}` });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Remove all existing global role assignments
    const existingGlobalRoles = await prisma.userRole.findMany({
      where: { userId: id, stationId: "global" },
    });
    await prisma.userRole.deleteMany({
      where: { id: { in: existingGlobalRoles.map(r => r.id) } },
    });

    // Ensure Employee is always included
    const finalRoles = [...new Set([...roles, "Employee"])];

    for (const roleName of finalRoles) {
      const roleRecord = await prisma.role.findUnique({ where: { name: roleName } });
      if (!roleRecord) continue;
      await prisma.userRole.create({
        data: { userId: id, roleId: roleRecord.id, stationId: "global" },
      });
    }

    // If the user's activeRole is no longer in the new set, reset to the first assigned role
    if (!finalRoles.includes(user.activeRole)) {
      const newActive = finalRoles[0];
      await prisma.user.update({ where: { id }, data: { activeRole: newActive } });
    }

    invalidateCache(id);

    res.json({
      success: true,
      message: "Roles updated",
      data: await buildUserSummary(await prisma.user.findUnique({ where: { id } })),
    });
  } catch (err) {
    next(err);
  }
}

// ── PUT /users/:id/status ─────────────────────────────────────────────────────
// Body: { status: "Active" | "Inactive" | "Suspended" }

async function updateUserStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(422).json({ success: false, message: `Status must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Prevent deactivating your own account
    if (id === req.user.sub && status !== "Active") {
      return res.status(403).json({ success: false, message: "You cannot deactivate your own account" });
    }

    const updated = await prisma.user.update({ where: { id }, data: { status } });

    // Revoke all sessions if account is suspended or deactivated
    if (status !== "Active") {
      await prisma.refreshToken.updateMany({
        where: { userId: id, revoked: false },
        data: { revoked: true },
      });
      invalidateCache(id);
    }

    res.json({
      success: true,
      message: `User status updated to ${status}`,
      data: await buildUserSummary(updated),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listUsers, createUser, getUser, assignRoles, updateUserStatus };
