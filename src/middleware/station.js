"use strict";
const prisma = require("../config/prisma");
const { hasPermission } = require("../services/permissionService");

/**
 * Resolves the active station ID for the current request.
 *
 * Admin (has "stations.view" permission):
 *   Returns the x-station-id header value, or null (cross-station for list ops).
 *
 * All other roles:
 *   Returns user.homeLocation — which is stored as a station ID.
 *   Returns null if the user has no home station assigned.
 */
async function resolveStation(req) {
  const isAdmin = await hasPermission(req.user.sub, "global", "stations.view");
  if (isAdmin) {
    const h = req.headers["x-station-id"];
    return h && h !== "global" ? h : null;
  }
  const u = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: { homeLocation: true },
  });
  return u?.homeLocation ?? null;
}

/**
 * Express middleware — attaches req.stationId and req.isAdmin after authentication.
 * Apply after authenticate() on any router that needs station context.
 */
async function attachStation(req, res, next) {
  try {
    req.isAdmin = await hasPermission(req.user.sub, "global", "stations.view");
    if (req.isAdmin) {
      const h = req.headers["x-station-id"];
      req.stationId = h && h !== "global" ? h : null;
    } else {
      const u = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { homeLocation: true },
      });
      req.stationId = u?.homeLocation ?? null;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Like attachStation but rejects the request when no station can be resolved.
 * Use on write operations where a definite station context is mandatory.
 */
function requireStation(req, res, next) {
  attachStation(req, res, () => {
    if (!req.stationId) {
      return res.status(422).json({
        success: false,
        message:
          "Station context required. Admins: send x-station-id header. " +
          "All others: your account must have a home station assigned.",
      });
    }
    next();
  });
}

/**
 * Returns true when the requesting user may access data belonging to targetStationId.
 * Assumes req.isAdmin has already been set (call attachStation or resolveStation first).
 */
async function canAccessStation(req, targetStationId) {
  if (req.isAdmin !== undefined) {
    if (req.isAdmin) return true;
  } else {
    if (await hasPermission(req.user.sub, "global", "stations.view")) return true;
  }
  const u = await prisma.user.findUnique({
    where: { id: req.user.sub },
    select: { homeLocation: true },
  });
  return u?.homeLocation === targetStationId;
}

module.exports = { resolveStation, attachStation, requireStation, canAccessStation };
