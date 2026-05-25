"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const {
  listPermissions,
  getUserPermissions,
  updateUserPermissions,
  getPermissionMatrix,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
} = require("../controllers/permissionsController");

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get("/", requirePermission("settings.permissions.manage"), listPermissions);

// Roles CRUD
router.get("/roles",        requirePermission("settings.permissions.manage"), listRoles);
router.post("/roles",       requirePermission("settings.permissions.manage"), createRole);
router.put("/roles/:id",    requirePermission("settings.permissions.manage"), updateRole);
router.delete("/roles/:id", requirePermission("settings.permissions.manage"), deleteRole);

router.get(
  "/stations/:stationId/users/:userId",
  requirePermission("settings.permissions.manage"),
  getUserPermissions,
);

router.put(
  "/stations/:stationId/users/:userId",
  requirePermission("settings.permissions.manage"),
  updateUserPermissions,
);

router.get(
  "/stations/:stationId/matrix",
  requirePermission("settings.permissions.manage"),
  getPermissionMatrix,
);

module.exports = router;
