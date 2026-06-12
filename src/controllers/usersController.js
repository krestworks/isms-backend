"use strict";
const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");
const { config } = require("../config/env");
const { getEffectivePermissions, hasPermission, invalidateCache } = require("../services/permissionService");

const VALID_ROLES   = ["Admin", "Manager", "LocationHead", "Accountant", "Attendant", "Employee"];
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
// Admin: all users (filterable by station via ?stationId=).
// Manager/LocationHead: only users whose homeLocation matches their own station.
// Others: 403.

async function listUsers(req, res, next) {
  try {
    const { status, role, page = "1", limit = "25" } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    const isAdmin = await hasPermission(req.user.sub, "global", "stations.view");

    const where = {};
    if (status) where.status = status;
    if (role) where.userRoles = { some: { role: { name: role } } };

    if (!isAdmin) {
      // Non-admins only see users assigned to their station
      const caller = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { homeLocation: true },
      });
      if (!caller?.homeLocation) {
        return res.json({ success: true, data: [], meta: { page: pageNum, limit: limitNum, total: 0, pages: 0 } });
      }
      where.homeLocation = caller.homeLocation;
    } else if (req.query.stationId) {
      // Admin can optionally filter by a specific station
      where.homeLocation = req.query.stationId;
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
    res.json({ success: true, data, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) {
    next(err);
  }
}

// ── POST /users ───────────────────────────────────────────────────────────────
// Admin: can set homeLocation freely.
// Manager/LocationHead: homeLocation is forced to their own station.

async function createUser(req, res, next) {
  try {
    const { email, password, name, phone, employeeId, activeRole = "Employee", homeLocation, isEmployee = false, roles = [] } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ success: false, message: "A user with this email already exists" });

    const defaultRole = activeRole || "Employee";
    if (!VALID_ROLES.includes(defaultRole)) {
      return res.status(422).json({ success: false, message: `Invalid activeRole: ${defaultRole}` });
    }

    const isAdmin = await hasPermission(req.user.sub, "global", "stations.view");

    let resolvedHomeLocation = homeLocation || undefined;

    if (!isAdmin) {
      // Non-admins must create users at their own station
      const caller = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { homeLocation: true },
      });
      if (!caller?.homeLocation) {
        return res.status(422).json({ success: false, message: "Your account has no home station — cannot create users" });
      }
      resolvedHomeLocation = caller.homeLocation;
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
        homeLocation: resolvedHomeLocation,
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

    // Always ensure the base Employee role is present
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

    res.status(201).json({ success: true, message: "User created successfully", data: await buildUserSummary(user) });
  } catch (err) {
    next(err);
  }
}

// ── GET /users/:id ────────────────────────────────────────────────────────────
// Admin: any user.
// Others: only users at their own station.

async function getUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const isAdmin = await hasPermission(req.user.sub, "global", "stations.view");
    if (!isAdmin) {
      const caller = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { homeLocation: true },
      });
      if (caller?.homeLocation !== user.homeLocation) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const permCodes = await getEffectivePermissions(user.id, "global");
    const summary   = await buildUserSummary(user);
    res.json({ success: true, data: { ...summary, permissions: Array.from(permCodes) } });
  } catch (err) {
    next(err);
  }
}

// ── PUT /users/:id ────────────────────────────────────────────────────────────

async function updateUser(req, res, next) {
  try {
    const { id } = req.params;
    const { name, phone, homeLocation } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const isAdmin = await hasPermission(req.user.sub, "global", "stations.view");
    if (!isAdmin) {
      const caller = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { homeLocation: true },
      });
      if (caller?.homeLocation !== user.homeLocation) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const data = {
      name:  name  !== undefined ? (name  || undefined) : undefined,
      phone: phone !== undefined ? (phone || null)      : undefined,
    };
    if (isAdmin && homeLocation !== undefined) {
      data.homeLocation = homeLocation || null;
    }

    const updated = await prisma.user.update({ where: { id }, data });
    res.json({ success: true, message: "User updated", data: await buildUserSummary(updated) });
  } catch (err) {
    next(err);
  }
}

// ── PUT /users/:id/roles ──────────────────────────────────────────────────────
// Replaces all global role assignments. Admin only (protected at route level).

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

    // Non-admins can only manage users at their own station
    const isAdmin = await hasPermission(req.user.sub, "global", "stations.view");
    if (!isAdmin) {
      const caller = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { homeLocation: true },
      });
      if (caller?.homeLocation !== user.homeLocation) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    // Remove all existing global role assignments
    const existingGlobal = await prisma.userRole.findMany({ where: { userId: id, stationId: "global" } });
    await prisma.userRole.deleteMany({ where: { id: { in: existingGlobal.map(r => r.id) } } });

    const finalRoles = [...new Set([...roles, "Employee"])];
    for (const roleName of finalRoles) {
      const roleRecord = await prisma.role.findUnique({ where: { name: roleName } });
      if (!roleRecord) continue;
      await prisma.userRole.create({ data: { userId: id, roleId: roleRecord.id, stationId: "global" } });
    }

    if (!finalRoles.includes(user.activeRole)) {
      await prisma.user.update({ where: { id }, data: { activeRole: finalRoles[0] } });
    }

    invalidateCache(id);
    res.json({ success: true, message: "Roles updated", data: await buildUserSummary(await prisma.user.findUnique({ where: { id } })) });
  } catch (err) {
    next(err);
  }
}

// ── PUT /users/:id/status ─────────────────────────────────────────────────────

async function updateUserStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(422).json({ success: false, message: `Status must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (id === req.user.sub && status !== "Active") {
      return res.status(403).json({ success: false, message: "You cannot deactivate your own account" });
    }

    // Non-admins can only manage users at their own station
    const isAdmin = await hasPermission(req.user.sub, "global", "stations.view");
    if (!isAdmin) {
      const caller = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { homeLocation: true },
      });
      if (caller?.homeLocation !== user.homeLocation) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const updated = await prisma.user.update({ where: { id }, data: { status } });

    if (status !== "Active") {
      await prisma.refreshToken.updateMany({ where: { userId: id, revoked: false }, data: { revoked: true } });
      invalidateCache(id);
    }

    res.json({ success: true, message: `User status updated to ${status}`, data: await buildUserSummary(updated) });
  } catch (err) {
    next(err);
  }
}

module.exports = { listUsers, createUser, getUser, updateUser, assignRoles, updateUserStatus };
