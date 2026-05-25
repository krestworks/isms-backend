"use strict";
const { hasPermission } = require("../services/permissionService");

function requirePermission(permCode) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    const stationId = req.headers["x-station-id"] || "global";
    try {
      const allowed = await hasPermission(req.user.sub, stationId, permCode);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
          error: { code: "PERMISSION_DENIED", permission: permCode },
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Role-name based check used for simple guards while routes are migrated to permission codes
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (allowedRoles.includes(req.user.activeRole)) return next();
    return res.status(403).json({
      success: false,
      message: `Access denied. Required role: ${allowedRoles.join(" or ")}`,
    });
  };
}

function requireAdmin(req, res, next) {
  return authorize("Admin")(req, res, next);
}

module.exports = { requirePermission, authorize, requireAdmin };
