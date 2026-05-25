"use strict";
const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { authenticate } = require("../middleware/auth");
const {
  login,
  logout,
  refresh,
  getMe,
  updateProfile,
  changePassword,
  requestPasswordReset,
  confirmPasswordReset,
  switchRole,
} = require("../controllers/authController");
const {
  loginRules,
  changePasswordRules,
  forgotPasswordRules,
  resetPasswordRules,
  switchRoleRules,
  validate,
} = require("../utils/validators");

const router = Router();

// 5 attempts per IP+email per 15 minutes — per spec §20.1
// Keying on IP+email prevents cross-account rate limit consumption while
// still blocking targeted brute-force against a specific account.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const ip = (req.ip || "").replace(/^::ffff:/, "");
    return `login:${ip}:${(req.body?.email || "").toLowerCase()}`;
  },
  validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
  message: { success: false, message: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { success: false, message: "Too many reset requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Public routes ─────────────────────────────────────────────────────────────
router.post("/login",             loginLimiter,   loginRules,          validate, login);
router.post("/refresh",                                                           refresh);
router.post("/password/reset",    forgotLimiter,  forgotPasswordRules, validate, requestPasswordReset);
router.post("/password/confirm",                  resetPasswordRules,  validate, confirmPasswordReset);

// ── Protected routes ──────────────────────────────────────────────────────────
router.post("/logout",            authenticate,                                   logout);
router.get( "/me",                authenticate,                                   getMe);
router.put( "/profile",           authenticate,                                   updateProfile);
router.put( "/change-password",   authenticate,  changePasswordRules, validate,  changePassword);
router.put( "/switch-role",       authenticate,  switchRoleRules,     validate,  switchRole);

module.exports = router;
