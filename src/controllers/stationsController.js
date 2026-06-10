"use strict";
const prisma = require("../config/prisma");
const { hasPermission } = require("../services/permissionService");

const VALID_TYPES   = ["Branch", "Headquarters", "Franchise", "Depot", "Region", "Outlet"];
const VALID_STATUSES = ["Active", "Inactive", "Maintenance"];

// ── GET /stations ─────────────────────────────────────────────────────────────

async function listStations(req, res, next) {
  try {
    const { status, include_deleted } = req.query;

    const canViewAll = await hasPermission(req.user.sub, "global", "stations.view");
    const canManage  = await hasPermission(req.user.sub, "global", "stations.manage");
    const showDeleted = include_deleted === "true" && canManage;

    const where = {};
    if (!showDeleted) where.deletedAt = null;
    if (status)       where.status = status;

    if (!canViewAll) {
      // Restrict to the user's home station only (homeLocation stores the station ID)
      const user = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { homeLocation: true },
      });
      if (user?.homeLocation) {
        where.id = user.homeLocation;
      } else {
        return res.json({ success: true, data: [] });
      }
    }

    const stations = await prisma.station.findMany({ where, orderBy: { name: "asc" } });
    res.json({ success: true, data: stations });
  } catch (err) {
    next(err);
  }
}

// ── POST /stations ────────────────────────────────────────────────────────────

async function createStation(req, res, next) {
  try {
    const { name, type = "Branch", status = "Active", city, address, phone, openedOn } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(422).json({ success: false, message: "Station name is required" });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(422).json({ success: false, message: `type must be one of: ${VALID_TYPES.join(", ")}` });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(422).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    // Enforce name uniqueness among non-deleted stations
    const existing = await prisma.station.findFirst({ where: { name: name.trim(), deletedAt: null } });
    if (existing) {
      return res.status(409).json({ success: false, message: "A station with this name already exists" });
    }

    const station = await prisma.station.create({
      data: {
        name: name.trim(), type, status,
        city: city?.trim() || null,
        address: address?.trim() || null,
        phone: phone?.trim() || null,
        openedOn: openedOn ? new Date(openedOn) : null,
      },
    });

    res.status(201).json({ success: true, message: "Station created", data: station });
  } catch (err) {
    next(err);
  }
}

// ── GET /stations/:id ─────────────────────────────────────────────────────────

async function getStation(req, res, next) {
  try {
    const station = await prisma.station.findUnique({ where: { id: req.params.id } });
    if (!station || station.deletedAt) {
      return res.status(404).json({ success: false, message: "Station not found" });
    }

    // Non-admins may only view their own home station
    const canViewAll = await hasPermission(req.user.sub, "global", "stations.view");
    if (!canViewAll) {
      const user = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { homeLocation: true },
      });
      if (user?.homeLocation !== req.params.id) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const staffCount = await prisma.userRole.count({ where: { stationId: req.params.id } });
    res.json({ success: true, data: { ...station, staffCount } });
  } catch (err) {
    next(err);
  }
}

// ── PUT /stations/:id ─────────────────────────────────────────────────────────

async function updateStation(req, res, next) {
  try {
    const { name, type, status, city, address, phone, openedOn } = req.body;

    const station = await prisma.station.findUnique({ where: { id: req.params.id } });
    if (!station || station.deletedAt) {
      return res.status(404).json({ success: false, message: "Station not found" });
    }

    if (type && !VALID_TYPES.includes(type)) {
      return res.status(422).json({ success: false, message: `type must be one of: ${VALID_TYPES.join(", ")}` });
    }
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(422).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }
    if (name && name.trim() !== station.name) {
      const conflict = await prisma.station.findFirst({
        where: { name: name.trim(), deletedAt: null, NOT: { id: station.id } },
      });
      if (conflict) {
        return res.status(409).json({ success: false, message: "A station with this name already exists" });
      }
    }

    const updated = await prisma.station.update({
      where: { id: req.params.id },
      data: {
        name:     name     ? name.trim()          : undefined,
        type:     type     || undefined,
        status:   status   || undefined,
        city:     city     !== undefined ? (city?.trim()    || null) : undefined,
        address:  address  !== undefined ? (address?.trim() || null) : undefined,
        phone:    phone    !== undefined ? (phone?.trim()   || null) : undefined,
        openedOn: openedOn !== undefined ? (openedOn ? new Date(openedOn) : null) : undefined,
      },
    });

    res.json({ success: true, message: "Station updated", data: updated });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /stations/:id  (soft-delete) ───────────────────────────────────────

async function deleteStation(req, res, next) {
  try {
    const station = await prisma.station.findUnique({ where: { id: req.params.id } });
    if (!station || station.deletedAt) {
      return res.status(404).json({ success: false, message: "Station not found" });
    }

    await prisma.station.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date(), deletedBy: req.user.sub },
    });

    res.json({
      success: true,
      message: "Station scheduled for deletion. It will be permanently removed after 5 days.",
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /stations/:id/restore ────────────────────────────────────────────────

async function restoreStation(req, res, next) {
  try {
    const station = await prisma.station.findUnique({ where: { id: req.params.id } });
    if (!station) return res.status(404).json({ success: false, message: "Station not found" });
    if (!station.deletedAt) {
      return res.status(409).json({ success: false, message: "Station is not scheduled for deletion" });
    }

    const restored = await prisma.station.update({
      where: { id: req.params.id },
      data: { deletedAt: null, deletedBy: null },
    });

    res.json({ success: true, message: "Station restored", data: restored });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /stations/:id/purge  (permanent, only after 5-day grace) ───────────

async function purgeStation(req, res, next) {
  try {
    const station = await prisma.station.findUnique({ where: { id: req.params.id } });
    if (!station) return res.status(404).json({ success: false, message: "Station not found" });
    if (!station.deletedAt) {
      return res.status(422).json({ success: false, message: "Station must be soft-deleted before purging" });
    }

    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    if (station.deletedAt > fiveDaysAgo) {
      const msLeft  = station.deletedAt.getTime() + 5 * 24 * 60 * 60 * 1000 - Date.now();
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
      return res.status(422).json({
        success: false,
        message: `Station cannot be permanently deleted yet. ${daysLeft} day(s) remaining in the grace period.`,
      });
    }

    await prisma.station.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Station permanently deleted" });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listStations, createStation, getStation, updateStation,
  deleteStation, restoreStation, purgeStation,
};
