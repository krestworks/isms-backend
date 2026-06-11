"use strict";
const prisma = require("../config/prisma");
const { resolveStation, canAccessStation } = require("../middleware/station");

async function listHolidays(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const { year } = req.query;

    const where = stationId
      ? { OR: [{ stationId }, { stationId: "global" }] }
      : {};

    if (year) {
      const y = parseInt(year, 10);
      where.OR = (where.OR || [{ stationId: "global" }]).map(c => c);
      // Filter by year for non-recurring; recurring ones always apply
      // We return all and let the client filter by year for recurring
    }

    const holidays = await prisma.publicHoliday.findMany({
      where,
      orderBy: { date: "asc" },
    });

    res.json({ success: true, data: holidays });
  } catch (err) {
    next(err);
  }
}

async function createHoliday(req, res, next) {
  try {
    const stationId = await resolveStation(req);

    const { name, date, isRecurring = true } = req.body;
    if (!name) return res.status(422).json({ success: false, message: "name is required" });
    if (!date)  return res.status(422).json({ success: false, message: "date is required" });

    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(422).json({ success: false, message: "Invalid date" });
    }

    const holiday = await prisma.publicHoliday.create({
      data: {
        name: name.trim(),
        date: parsedDate,
        isRecurring: Boolean(isRecurring),
        stationId: stationId || "global",
      },
    });

    res.status(201).json({ success: true, message: "Holiday created", data: holiday });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A holiday with this name already exists" });
    }
    next(err);
  }
}

async function updateHoliday(req, res, next) {
  try {
    const holiday = await prisma.publicHoliday.findUnique({ where: { id: req.params.id } });
    if (!holiday) return res.status(404).json({ success: false, message: "Holiday not found" });

    if (!await canAccessStation(req, holiday.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { name, date, isRecurring } = req.body;
    const updated = await prisma.publicHoliday.update({
      where: { id: req.params.id },
      data: {
        name:        name        ? name.trim()          : undefined,
        date:        date        ? new Date(date)       : undefined,
        isRecurring: isRecurring !== undefined ? Boolean(isRecurring) : undefined,
      },
    });

    res.json({ success: true, message: "Holiday updated", data: updated });
  } catch (err) {
    next(err);
  }
}

async function deleteHoliday(req, res, next) {
  try {
    const holiday = await prisma.publicHoliday.findUnique({ where: { id: req.params.id } });
    if (!holiday) return res.status(404).json({ success: false, message: "Holiday not found" });

    if (!await canAccessStation(req, holiday.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    await prisma.publicHoliday.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Holiday deleted" });
  } catch (err) {
    next(err);
  }
}

module.exports = { listHolidays, createHoliday, updateHoliday, deleteHoliday };
