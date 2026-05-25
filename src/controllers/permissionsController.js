"use strict";
const prisma = require("../config/prisma");
const { getEffectivePermissions, invalidateCache } = require("../services/permissionService");

// ── GET /permissions ──────────────────────────────────────────────────────────
// Returns all permission codes grouped by category.

async function listPermissions(req, res, next) {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: [{ category: "asc" }, { code: "asc" }],
      select: { code: true, description: true, category: true },
    });

    // Group by category for convenience
    const grouped = {};
    for (const p of permissions) {
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push({ code: p.code, description: p.description });
    }

    res.json({ success: true, data: { permissions: grouped, total: permissions.length } });
  } catch (err) {
    next(err);
  }
}

// ── GET /stations/:stationId/users/:userId/permissions ────────────────────────
// Returns the user's effective permissions at a station, showing both the
// role-default source and any user-level overrides.

async function getUserPermissions(req, res, next) {
  try {
    const { stationId, userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, activeRole: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Load all permissions for the active role
    const role = await prisma.role.findUnique({
      where: { name: user.activeRole },
      include: { rolePermissions: { include: { permission: true } } },
    });
    const roleCodes = new Set(role ? role.rolePermissions.map(rp => rp.permission.code) : []);

    // Load all user-level overrides for this station + global
    const overrides = await prisma.userPermission.findMany({
      where: {
        userId,
        stationId: { in: ["global", stationId] },
      },
      include: { permission: true },
    });
    const overrideMap = new Map(overrides.map(o => [o.permission.code, o]));

    // Load all permissions to build the full matrix
    const allPermissions = await prisma.permission.findMany({
      orderBy: [{ category: "asc" }, { code: "asc" }],
    });

    const matrix = allPermissions.map(p => {
      const fromRole = roleCodes.has(p.code);
      const override = overrideMap.get(p.code);
      let effective = fromRole;
      let source = fromRole ? "role" : "none";
      if (override) {
        effective = override.granted;
        source = override.granted ? "user-grant" : "user-revoke";
      }
      return {
        code: p.code,
        category: p.category,
        description: p.description,
        fromRole,
        override: override ? { granted: override.granted, grantedBy: override.grantedBy, grantedAt: override.grantedAt } : null,
        effective,
        source,
      };
    });

    res.json({
      success: true,
      data: {
        user: { id: user.id, name: user.name, email: user.email, activeRole: user.activeRole },
        stationId,
        permissions: matrix,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── PUT /stations/:stationId/users/:userId/permissions ────────────────────────
// Body: { grants: string[], revokes: string[] }
// Managers can only grant permissions they themselves hold.
// Admins may grant anything.

async function updateUserPermissions(req, res, next) {
  try {
    const { stationId, userId } = req.params;
    const { grants = [], revokes = [] } = req.body;
    const requesterId = req.user.sub;

    if (!Array.isArray(grants) || !Array.isArray(revokes)) {
      return res.status(422).json({ success: false, message: "grants and revokes must be arrays" });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Build the requester's effective permissions to enforce the "can't grant above own level" rule
    const requesterCodes = await getEffectivePermissions(requesterId, stationId);

    const unauthorized = grants.filter(code => !requesterCodes.has(code));
    if (unauthorized.length > 0) {
      return res.status(403).json({
        success: false,
        message: "Cannot grant permissions you do not hold",
        error: { code: "PERMISSION_ESCALATION", permissions: unauthorized },
      });
    }

    const allCodes = [...new Set([...grants, ...revokes])];
    if (allCodes.length === 0) {
      return res.status(422).json({ success: false, message: "No permission changes provided" });
    }

    // Resolve permission IDs
    const permRecords = await prisma.permission.findMany({
      where: { code: { in: allCodes } },
    });
    const permMap = new Map(permRecords.map(p => [p.code, p.id]));

    const unknown = allCodes.filter(c => !permMap.has(c));
    if (unknown.length > 0) {
      return res.status(422).json({ success: false, message: "Unknown permission codes", error: { codes: unknown } });
    }

    // Upsert each change
    const changes = [];
    for (const code of grants) {
      const permissionId = permMap.get(code);
      await prisma.userPermission.upsert({
        where: { userId_permissionId_stationId: { userId, permissionId, stationId } },
        update: { granted: true, grantedBy: requesterId, grantedAt: new Date() },
        create: { userId, permissionId, stationId, granted: true, grantedBy: requesterId },
      });
      changes.push({ code, action: "granted" });
    }
    for (const code of revokes) {
      const permissionId = permMap.get(code);
      await prisma.userPermission.upsert({
        where: { userId_permissionId_stationId: { userId, permissionId, stationId } },
        update: { granted: false, grantedBy: requesterId, grantedAt: new Date() },
        create: { userId, permissionId, stationId, granted: false, grantedBy: requesterId },
      });
      changes.push({ code, action: "revoked" });
    }

    // Invalidate cache so changes take effect on the user's next request
    invalidateCache(userId, stationId);

    res.json({
      success: true,
      message: `${changes.length} permission change(s) applied`,
      data: { changes },
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /stations/:stationId/permissions/matrix ───────────────────────────────
// Full permission matrix for all users at a station.

async function getPermissionMatrix(req, res, next) {
  try {
    const { stationId } = req.params;

    // All users assigned to this station (or globally)
    const userRoles = await prisma.userRole.findMany({
      where: { stationId: { in: ["global", stationId] } },
      include: {
        user: { select: { id: true, name: true, email: true, activeRole: true, status: true } },
        role: true,
      },
    });

    // Deduplicate users
    const userMap = new Map();
    for (const ur of userRoles) {
      if (!userMap.has(ur.user.id)) {
        userMap.set(ur.user.id, { user: ur.user, roles: [] });
      }
      userMap.get(ur.user.id).roles.push(ur.role.name);
    }

    const allPermissions = await prisma.permission.findMany({
      orderBy: [{ category: "asc" }, { code: "asc" }],
      select: { code: true, category: true, description: true },
    });

    const rows = await Promise.all(
      Array.from(userMap.values()).map(async ({ user, roles }) => {
        const effectiveCodes = await getEffectivePermissions(user.id, stationId);
        return {
          user: { id: user.id, name: user.name, email: user.email, activeRole: user.activeRole, status: user.status },
          roles,
          permissions: Object.fromEntries(allPermissions.map(p => [p.code, effectiveCodes.has(p.code)])),
        };
      }),
    );

    res.json({
      success: true,
      data: {
        stationId,
        permissionCodes: allPermissions.map(p => ({ code: p.code, category: p.category, description: p.description })),
        users: rows,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── Roles CRUD ────────────────────────────────────────────────────────────────

async function listRoles(_req, res, next) {
  try {
    const roles = await prisma.role.findMany({
      orderBy: { name: "asc" },
      include: {
        rolePermissions: { include: { permission: { select: { code: true } } } },
        _count: { select: { userRoles: true } },
      },
    });
    const data = roles.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      usersCount: r._count.userRoles,
      permissions: r.rolePermissions.map(rp => rp.permission.code),
      status: "active",
    }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

async function createRole(req, res, next) {
  try {
    const { name, description, permissions = [] } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "name is required" });

    const role = await prisma.role.create({ data: { name, description } });

    if (permissions.length > 0) {
      const permRecords = await prisma.permission.findMany({ where: { code: { in: permissions } } });
      await prisma.rolePermission.createMany({
        data: permRecords.map(p => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }

    res.status(201).json({ success: true, data: { ...role, permissions, usersCount: 0, status: "active" } });
  } catch (err) { next(err); }
}

async function updateRole(req, res, next) {
  try {
    const { id } = req.params;
    const { name, description, permissions } = req.body;

    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });

    const data = {};
    if (name        !== undefined) data.name        = name;
    if (description !== undefined) data.description = description;
    await prisma.role.update({ where: { id }, data });

    if (Array.isArray(permissions)) {
      await prisma.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissions.length > 0) {
        const permRecords = await prisma.permission.findMany({ where: { code: { in: permissions } } });
        await prisma.rolePermission.createMany({
          data: permRecords.map(p => ({ roleId: id, permissionId: p.id })),
          skipDuplicates: true,
        });
      }
    }

    const updated = await prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: { include: { permission: { select: { code: true } } } },
        _count: { select: { userRoles: true } },
      },
    });

    res.json({
      success: true,
      data: {
        id: updated.id, name: updated.name, description: updated.description,
        usersCount: updated._count.userRoles,
        permissions: updated.rolePermissions.map(rp => rp.permission.code),
        status: "active",
      },
    });
  } catch (err) { next(err); }
}

async function deleteRole(req, res, next) {
  try {
    const { id } = req.params;
    const PROTECTED = ["Admin", "Manager", "Employee", "Attendant", "Accountant", "LocationHead"];
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role) return res.status(404).json({ success: false, message: "Role not found" });
    if (PROTECTED.includes(role.name)) {
      return res.status(403).json({ success: false, message: "Cannot delete a built-in role" });
    }
    await prisma.role.delete({ where: { id } });
    res.json({ success: true, data: { id } });
  } catch (err) { next(err); }
}

module.exports = { listPermissions, getUserPermissions, updateUserPermissions, getPermissionMatrix, listRoles, createRole, updateRole, deleteRole };
