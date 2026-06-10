"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const { listUsers, createUser, getUser, updateUser, assignRoles, updateUserStatus } = require("../controllers/usersController");
const { createUserRules, assignRolesRules, updateUserStatusRules, validate } = require("../utils/validators");

const router = Router();

router.use(authenticate);

router.get(  "/",          requirePermission("settings.users.manage"), listUsers);
router.post( "/",          requirePermission("settings.users.manage"), createUserRules, validate, createUser);
router.get(  "/:id",       requirePermission("settings.users.manage"), getUser);
router.put(  "/:id",       requirePermission("settings.users.manage"), updateUser);
router.put(  "/:id/roles", requirePermission("settings.users.manage"), assignRolesRules, validate, assignRoles);
router.put(  "/:id/status",requirePermission("settings.users.manage"), updateUserStatusRules, validate, updateUserStatus);

module.exports = router;
