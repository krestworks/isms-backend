"use strict";
const prisma = require("../config/prisma");

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cache = new Map(); // key: "userId:stationId:activeRole" → { codes: Set<string>, expiresAt: number }

async function getEffectivePermissions(userId, stationId = "global") {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeRole: true },
  });
  if (!user) return new Set();

  const cacheKey = `${userId}:${stationId}:${user.activeRole}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.codes;

  // Load role-based permissions for the active role only
  const role = await prisma.role.findUnique({
    where: { name: user.activeRole },
    include: {
      rolePermissions: { include: { permission: true } },
    },
  });

  const codes = new Set();
  if (role) {
    for (const rp of role.rolePermissions) {
      codes.add(rp.permission.code);
    }
  }

  // Apply user-level overrides (global + station-specific)
  const userPerms = await prisma.userPermission.findMany({
    where: {
      userId,
      stationId: { in: ["global", stationId] },
    },
    include: { permission: true },
  });

  for (const up of userPerms) {
    if (up.granted) codes.add(up.permission.code);
    else codes.delete(up.permission.code);
  }

  cache.set(cacheKey, { codes, expiresAt: Date.now() + CACHE_TTL });
  return codes;
}

async function hasPermission(userId, stationId, permCode) {
  const codes = await getEffectivePermissions(userId, stationId);
  return codes.has(permCode);
}

function invalidateCache(userId, stationId) {
  if (stationId) {
    // Invalidate all cache entries for this user+station combination (any role)
    for (const key of cache.keys()) {
      if (key.startsWith(`${userId}:${stationId}:`)) cache.delete(key);
    }
  } else {
    // Invalidate all entries for this user
    for (const key of cache.keys()) {
      if (key.startsWith(`${userId}:`)) cache.delete(key);
    }
  }
}

module.exports = { getEffectivePermissions, hasPermission, invalidateCache };
