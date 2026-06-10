"use strict";
const prisma = require("../config/prisma");
const { resolveStation, canAccessStation } = require("../middleware/station");

// ── Shift Patterns ────────────────────────────────────────────────────────────

async function listShiftPatterns(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const where = stationId ? { stationId } : {};

    const patterns = await prisma.shiftPattern.findMany({
      where,
      include: { _count: { select: { assignments: true } } },
      orderBy: { name: "asc" },
    });
    res.json({ success: true, data: patterns });
  } catch (err) {
    next(err);
  }
}

async function createShiftPattern(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) {
      return res.status(422).json({ success: false, message: "Station context required" });
    }

    const { name, startTime, endTime, isDefault = false } = req.body;
    if (!name || !startTime || !endTime) {
      return res.status(422).json({ success: false, message: "name, startTime, and endTime are required" });
    }

    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeRe.test(startTime) || !timeRe.test(endTime)) {
      return res.status(422).json({ success: false, message: "startTime and endTime must be in HH:mm format" });
    }

    if (isDefault) {
      await prisma.shiftPattern.updateMany({ where: { stationId, isDefault: true }, data: { isDefault: false } });
    }

    const pattern = await prisma.shiftPattern.create({
      data: { name: name.trim(), startTime, endTime, stationId, isDefault: Boolean(isDefault) },
    });

    res.status(201).json({ success: true, message: "Shift pattern created", data: pattern });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A shift pattern with this name already exists for this station" });
    }
    next(err);
  }
}

async function updateShiftPattern(req, res, next) {
  try {
    const pattern = await prisma.shiftPattern.findUnique({ where: { id: req.params.id } });
    if (!pattern) return res.status(404).json({ success: false, message: "Shift pattern not found" });

    if (!await canAccessStation(req, pattern.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { name, startTime, endTime, isDefault } = req.body;
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (startTime && !timeRe.test(startTime)) {
      return res.status(422).json({ success: false, message: "startTime must be in HH:mm format" });
    }
    if (endTime && !timeRe.test(endTime)) {
      return res.status(422).json({ success: false, message: "endTime must be in HH:mm format" });
    }

    if (isDefault) {
      await prisma.shiftPattern.updateMany({
        where: { stationId: pattern.stationId, isDefault: true, id: { not: pattern.id } },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.shiftPattern.update({
      where: { id: req.params.id },
      data: {
        name:      name      ? name.trim() : undefined,
        startTime: startTime || undefined,
        endTime:   endTime   || undefined,
        isDefault: isDefault !== undefined ? Boolean(isDefault) : undefined,
      },
    });

    res.json({ success: true, message: "Shift pattern updated", data: updated });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A shift pattern with this name already exists for this station" });
    }
    next(err);
  }
}

async function deleteShiftPattern(req, res, next) {
  try {
    const pattern = await prisma.shiftPattern.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { assignments: true } } },
    });
    if (!pattern) return res.status(404).json({ success: false, message: "Shift pattern not found" });

    if (!await canAccessStation(req, pattern.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (pattern._count.assignments > 0) {
      return res.status(409).json({ success: false, message: "Cannot delete: shift pattern has existing assignments" });
    }

    await prisma.shiftPattern.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Shift pattern deleted" });
  } catch (err) {
    next(err);
  }
}

// ── Shift Assignments ─────────────────────────────────────────────────────────

async function listShiftAssignments(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const { employeeId, from, to, page = "1", limit = "25" } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    const where = {};
    if (employeeId) where.employeeId = employeeId;
    if (stationId)  where.stationId  = stationId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to)   where.date.lte = new Date(to);
    }

    const [assignments, total] = await prisma.$transaction([
      prisma.shiftAssignment.findMany({
        where,
        include: {
          employee: { include: { user: { select: { id: true, name: true } } } },
          shiftPattern: { select: { id: true, name: true, startTime: true, endTime: true } },
        },
        orderBy: { date: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.shiftAssignment.count({ where }),
    ]);

    res.json({ success: true, data: assignments, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) {
    next(err);
  }
}

async function assignShift(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) {
      return res.status(422).json({ success: false, message: "Station context required" });
    }

    const { employeeId, shiftPatternId, date } = req.body;
    if (!employeeId || !shiftPatternId || !date) {
      return res.status(422).json({ success: false, message: "employeeId, shiftPatternId, and date are required" });
    }

    const [emp, pattern] = await Promise.all([
      prisma.employee.findUnique({ where: { id: employeeId } }),
      prisma.shiftPattern.findUnique({ where: { id: shiftPatternId } }),
    ]);

    if (!emp)     return res.status(404).json({ success: false, message: "Employee not found" });
    if (!pattern) return res.status(404).json({ success: false, message: "Shift pattern not found" });

    // Both the employee and the shift pattern must belong to the caller's station
    if (emp.stationId !== stationId) {
      return res.status(403).json({ success: false, message: "Employee does not belong to your station" });
    }
    if (pattern.stationId !== stationId) {
      return res.status(403).json({ success: false, message: "Shift pattern does not belong to your station" });
    }

    const assignment = await prisma.shiftAssignment.upsert({
      where: { employeeId_date: { employeeId, date: new Date(date) } },
      update: { shiftPatternId, stationId, createdBy: req.user.sub },
      create: { employeeId, shiftPatternId, date: new Date(date), stationId, createdBy: req.user.sub },
      include: {
        employee: { include: { user: { select: { id: true, name: true } } } },
        shiftPattern: { select: { id: true, name: true, startTime: true, endTime: true } },
      },
    });

    res.status(201).json({ success: true, message: "Shift assigned", data: assignment });
  } catch (err) {
    next(err);
  }
}

// ── Attendance ────────────────────────────────────────────────────────────────

async function listAttendance(req, res, next) {
  try {
    const { employeeId, from, to, status, page = "1", limit = "25" } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    const callerEmployee = await prisma.employee.findUnique({ where: { userId: req.user.sub } });
    const isManager = ["Admin", "Manager", "LocationHead"].includes(req.user.activeRole);

    const where = {};
    if (status) where.status = status;

    if (!isManager && callerEmployee) {
      where.employeeId = callerEmployee.id;
    } else if (employeeId) {
      where.employeeId = employeeId;
    } else {
      // Managers are scoped to their station
      const stationId = await resolveStation(req);
      if (stationId) where.employee = { stationId };
    }

    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to)   where.date.lte = new Date(to);
    }

    const [records, total] = await prisma.$transaction([
      prisma.attendance.findMany({
        where,
        include: { employee: { include: { user: { select: { id: true, name: true } } } } },
        orderBy: { date: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.attendance.count({ where }),
    ]);

    res.json({ success: true, data: records, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) {
    next(err);
  }
}

async function checkIn(req, res, next) {
  try {
    const callerEmployee = await prisma.employee.findUnique({ where: { userId: req.user.sub } });
    if (!callerEmployee) {
      return res.status(404).json({ success: false, message: "No employee record linked to your account" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: callerEmployee.id, date: today } },
    });
    if (existing?.checkIn) {
      return res.status(409).json({ success: false, message: "You have already checked in today" });
    }

    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: callerEmployee.id, date: today } },
      update: { checkIn: new Date(), status: "Present" },
      create: { employeeId: callerEmployee.id, date: today, checkIn: new Date(), status: "Present" },
    });

    res.json({ success: true, message: "Checked in", data: record });
  } catch (err) {
    next(err);
  }
}

async function checkOut(req, res, next) {
  try {
    const callerEmployee = await prisma.employee.findUnique({ where: { userId: req.user.sub } });
    if (!callerEmployee) {
      return res.status(404).json({ success: false, message: "No employee record linked to your account" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: callerEmployee.id, date: today } },
    });
    if (!existing?.checkIn) {
      return res.status(409).json({ success: false, message: "You have not checked in today" });
    }
    if (existing.checkOut) {
      return res.status(409).json({ success: false, message: "You have already checked out today" });
    }

    const record = await prisma.attendance.update({
      where: { employeeId_date: { employeeId: callerEmployee.id, date: today } },
      data: { checkOut: new Date() },
    });

    res.json({ success: true, message: "Checked out", data: record });
  } catch (err) {
    next(err);
  }
}

async function upsertAttendance(req, res, next) {
  try {
    const { employeeId, date, checkIn, checkOut, status = "Present", note } = req.body;

    if (!employeeId || !date) {
      return res.status(422).json({ success: false, message: "employeeId and date are required" });
    }

    const VALID_STATUSES = ["Present", "Absent", "Late", "HalfDay", "OnLeave"];
    if (!VALID_STATUSES.includes(status)) {
      return res.status(422).json({ success: false, message: `status must be one of: ${VALID_STATUSES.join(", ")}` });
    }

    const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    // Manager can only record attendance for employees at their own station
    if (!await canAccessStation(req, emp.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const dayDate = new Date(date);
    dayDate.setHours(0, 0, 0, 0);

    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: dayDate } },
      update: {
        checkIn:    checkIn  ? new Date(checkIn)  : undefined,
        checkOut:   checkOut ? new Date(checkOut) : undefined,
        status,
        note:       note || undefined,
        recordedBy: req.user.sub,
      },
      create: {
        employeeId,
        date: dayDate,
        checkIn:    checkIn  ? new Date(checkIn)  : null,
        checkOut:   checkOut ? new Date(checkOut) : null,
        status,
        note:       note || null,
        recordedBy: req.user.sub,
      },
      include: { employee: { include: { user: { select: { id: true, name: true } } } } },
    });

    res.json({ success: true, message: "Attendance record saved", data: record });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listShiftPatterns, createShiftPattern, updateShiftPattern, deleteShiftPattern,
  listShiftAssignments, assignShift,
  listAttendance, checkIn, checkOut, upsertAttendance,
};
