"use strict";
const prisma = require("../config/prisma");
const { resolveStation, canAccessStation } = require("../middleware/station");

// ── Leave Types ───────────────────────────────────────────────────────────────

async function listLeaveTypes(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const where = stationId
      ? { OR: [{ stationId }, { stationId: "global" }] }
      : {};

    const types = await prisma.leaveType.findMany({ where, orderBy: { name: "asc" } });
    res.json({ success: true, data: types });
  } catch (err) {
    next(err);
  }
}

async function createLeaveType(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) {
      return res.status(422).json({ success: false, message: "Station context required" });
    }

    const { name, daysAllowed = 21, isPaid = true } = req.body;
    if (!name) return res.status(422).json({ success: false, message: "name is required" });

    const lt = await prisma.leaveType.create({
      data: { name: name.trim(), daysAllowed: parseInt(daysAllowed, 10), isPaid: Boolean(isPaid), stationId },
    });

    res.status(201).json({ success: true, message: "Leave type created", data: lt });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A leave type with this name already exists for this station" });
    }
    next(err);
  }
}

async function updateLeaveType(req, res, next) {
  try {
    const lt = await prisma.leaveType.findUnique({ where: { id: req.params.id } });
    if (!lt) return res.status(404).json({ success: false, message: "Leave type not found" });

    if (!await canAccessStation(req, lt.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const {
      name, daysAllowed, isPaid, isActive,
      carryOver, carryOverMax, noticeDays, maxConsecutive,
      minTenureMonths, genderRestriction, accrualType,
      excludeHolidays, excludeWeekends,
    } = req.body;

    const updated = await prisma.leaveType.update({
      where: { id: req.params.id },
      data: {
        name:              name              ? name.trim()                       : undefined,
        daysAllowed:       daysAllowed       !== undefined ? parseInt(daysAllowed, 10)       : undefined,
        isPaid:            isPaid            !== undefined ? Boolean(isPaid)                 : undefined,
        isActive:          isActive          !== undefined ? Boolean(isActive)               : undefined,
        carryOver:         carryOver         !== undefined ? Boolean(carryOver)              : undefined,
        carryOverMax:      carryOverMax      !== undefined ? parseInt(carryOverMax, 10)      : undefined,
        noticeDays:        noticeDays        !== undefined ? parseInt(noticeDays, 10)        : undefined,
        maxConsecutive:    maxConsecutive    !== undefined ? parseInt(maxConsecutive, 10)    : undefined,
        minTenureMonths:   minTenureMonths   !== undefined ? parseInt(minTenureMonths, 10)   : undefined,
        genderRestriction: genderRestriction !== undefined ? (genderRestriction || null)     : undefined,
        accrualType:       accrualType       !== undefined ? accrualType                     : undefined,
        excludeHolidays:   excludeHolidays   !== undefined ? Boolean(excludeHolidays)        : undefined,
        excludeWeekends:   excludeWeekends   !== undefined ? Boolean(excludeWeekends)        : undefined,
      },
    });

    res.json({ success: true, message: "Leave type updated", data: updated });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A leave type with this name already exists for this station" });
    }
    next(err);
  }
}

async function deleteLeaveType(req, res, next) {
  try {
    const lt = await prisma.leaveType.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { requests: true, balances: true } } },
    });
    if (!lt) return res.status(404).json({ success: false, message: "Leave type not found" });

    if (!await canAccessStation(req, lt.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (lt._count.requests > 0) {
      return res.status(409).json({ success: false, message: "Cannot delete: leave type has existing requests" });
    }

    await prisma.$transaction([
      prisma.leaveBalance.deleteMany({ where: { leaveTypeId: req.params.id } }),
      prisma.leaveType.delete({ where: { id: req.params.id } }),
    ]);

    res.json({ success: true, message: "Leave type deleted" });
  } catch (err) {
    next(err);
  }
}

// ── Leave Balances ────────────────────────────────────────────────────────────

async function getLeaveBalances(req, res, next) {
  try {
    const { employeeId, year: qYear } = req.query;
    const year = parseInt(qYear, 10) || new Date().getFullYear();

    const callerEmployee = await prisma.employee.findUnique({ where: { userId: req.user.sub } });
    const scopedEmployeeId = employeeId || callerEmployee?.id;

    if (!scopedEmployeeId) {
      return res.status(422).json({ success: false, message: "employeeId is required" });
    }

    const emp = await prisma.employee.findUnique({ where: { id: scopedEmployeeId } });
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    // Non-managers can only view their own balances
    const isManager = ["Admin", "Manager", "LocationHead"].includes(req.user.activeRole);
    if (!isManager && callerEmployee?.id !== scopedEmployeeId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    if (!await canAccessStation(req, emp.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const balances = await prisma.leaveBalance.findMany({
      where: { employeeId: scopedEmployeeId, year },
      include: { leaveType: { select: { id: true, name: true, isPaid: true, daysAllowed: true } } },
    });

    const data = balances.map(b => ({
      leaveType: b.leaveType,
      year: b.year,
      total: b.total,
      used: b.used,
      pending: b.pending,
      available: b.total - b.used - b.pending,
    }));

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ── Leave Requests ────────────────────────────────────────────────────────────

async function listLeaveRequests(req, res, next) {
  try {
    const { status, employeeId, page = "1", limit = "25" } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    const callerEmployee = await prisma.employee.findUnique({ where: { userId: req.user.sub } });
    const isManager = ["Admin", "Manager", "LocationHead"].includes(req.user.activeRole);

    const where = {};
    if (status) where.status = status;

    if (!isManager && callerEmployee) {
      // Employees see only their own requests
      where.employeeId = callerEmployee.id;
    } else if (employeeId) {
      where.employeeId = employeeId;
    } else {
      // Managers are scoped to their station's employees
      const stationId = await resolveStation(req);
      if (stationId) {
        where.employee = { stationId };
      }
    }

    const [requests, total] = await prisma.$transaction([
      prisma.leaveRequest.findMany({
        where,
        include: {
          employee: { include: { user: { select: { id: true, name: true, email: true } } } },
          leaveType: { select: { id: true, name: true, isPaid: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    res.json({ success: true, data: requests, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) {
    next(err);
  }
}

async function submitLeaveRequest(req, res, next) {
  try {
    const { leaveTypeId, startDate, endDate, reason } = req.body;

    if (!leaveTypeId || !startDate || !endDate) {
      return res.status(422).json({ success: false, message: "leaveTypeId, startDate, and endDate are required" });
    }

    const callerEmployee = await prisma.employee.findUnique({ where: { userId: req.user.sub } });
    if (!callerEmployee) {
      return res.status(404).json({ success: false, message: "No employee record linked to your account" });
    }
    if (callerEmployee.status !== "Active") {
      return res.status(409).json({ success: false, message: "Only active employees can submit leave requests" });
    }

    const start = new Date(startDate);
    const end   = new Date(endDate);
    if (end < start) {
      return res.status(422).json({ success: false, message: "endDate must be on or after startDate" });
    }

    const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType || !leaveType.isActive) {
      return res.status(404).json({ success: false, message: "Leave type not found or inactive" });
    }

    // ── Policy enforcement ────────────────────────────────────────────────────

    // Notice period
    if (leaveType.noticeDays > 0) {
      const minStart = new Date();
      minStart.setDate(minStart.getDate() + leaveType.noticeDays);
      minStart.setHours(0, 0, 0, 0);
      if (start < minStart) {
        return res.status(422).json({
          success: false,
          message: `This leave type requires at least ${leaveType.noticeDays} day(s) notice. Earliest start: ${minStart.toISOString().split("T")[0]}`,
        });
      }
    }

    // Gender restriction
    if (leaveType.genderRestriction) {
      if (!callerEmployee.gender || callerEmployee.gender.toLowerCase() !== leaveType.genderRestriction.toLowerCase()) {
        return res.status(403).json({
          success: false,
          message: `This leave type is only available for ${leaveType.genderRestriction} employees`,
        });
      }
    }

    // Minimum tenure
    if (leaveType.minTenureMonths > 0 && callerEmployee.startDate) {
      const tenureMs = Date.now() - new Date(callerEmployee.startDate).getTime();
      const tenureMonths = tenureMs / (1000 * 60 * 60 * 24 * 30.44);
      if (tenureMonths < leaveType.minTenureMonths) {
        return res.status(409).json({
          success: false,
          message: `You need at least ${leaveType.minTenureMonths} month(s) of service to apply for this leave`,
        });
      }
    }

    // Fetch public holidays for the station and date range
    const stationId = callerEmployee.stationId;
    const holidays = await prisma.publicHoliday.findMany({
      where: { OR: [{ stationId }, { stationId: "global" }] },
    });

    // Build a set of holiday date strings (YYYY-MM-DD) for the leave year(s)
    const holidaySet = new Set();
    if (leaveType.excludeHolidays) {
      for (const h of holidays) {
        const hDate = new Date(h.date);
        if (h.isRecurring) {
          // Apply to every year in the leave range
          const yearsInRange = new Set();
          const c2 = new Date(start);
          while (c2 <= end) { yearsInRange.add(c2.getFullYear()); c2.setDate(c2.getDate() + 1); }
          for (const yr of yearsInRange) {
            const d = new Date(yr, hDate.getMonth(), hDate.getDate());
            holidaySet.add(d.toISOString().split("T")[0]);
          }
        } else {
          holidaySet.add(hDate.toISOString().split("T")[0]);
        }
      }
    }

    // Count working days (excluding weekends and/or holidays per policy)
    let days = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const dow = cursor.getDay();
      const dateStr = cursor.toISOString().split("T")[0];
      const isWeekend  = dow === 0 || dow === 6;
      const isHoliday  = holidaySet.has(dateStr);
      if (!(leaveType.excludeWeekends && isWeekend) && !isHoliday) days++;
      cursor.setDate(cursor.getDate() + 1);
    }

    if (days === 0) {
      return res.status(422).json({ success: false, message: "The selected date range contains no working days" });
    }

    // Max consecutive days
    if (leaveType.maxConsecutive > 0 && days > leaveType.maxConsecutive) {
      return res.status(422).json({
        success: false,
        message: `This leave type allows a maximum of ${leaveType.maxConsecutive} consecutive working day(s) per request`,
      });
    }

    const year = start.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId: callerEmployee.id, leaveTypeId, year } },
    });
    if (!balance) {
      return res.status(409).json({ success: false, message: `No ${leaveType.name} balance found for ${year}` });
    }

    const available = balance.total - balance.used - balance.pending;
    if (days > available) {
      return res.status(409).json({
        success: false,
        message: `Insufficient leave balance. Requested: ${days} days, Available: ${available} days`,
      });
    }

    const overlap = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: callerEmployee.id,
        status: { in: ["Pending", "Approved"] },
        OR: [{ startDate: { lte: end }, endDate: { gte: start } }],
      },
    });
    if (overlap) {
      return res.status(409).json({ success: false, message: "You have an overlapping leave request for this period" });
    }

    const [request] = await prisma.$transaction([
      prisma.leaveRequest.create({
        data: { employeeId: callerEmployee.id, leaveTypeId, startDate: start, endDate: end, days, reason: reason || null, status: "Pending" },
        include: { leaveType: { select: { id: true, name: true, isPaid: true } } },
      }),
      prisma.leaveBalance.update({
        where: { employeeId_leaveTypeId_year: { employeeId: callerEmployee.id, leaveTypeId, year } },
        data: { pending: { increment: days } },
      }),
    ]);

    res.status(201).json({ success: true, message: "Leave request submitted", data: request });
  } catch (err) {
    next(err);
  }
}

async function getLeaveRequest(req, res, next) {
  try {
    const request = await prisma.leaveRequest.findUnique({
      where: { id: req.params.id },
      include: {
        employee: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } },
        leaveType: true,
      },
    });
    if (!request) return res.status(404).json({ success: false, message: "Leave request not found" });

    // Employees can only see their own requests
    const callerEmployee = await prisma.employee.findUnique({ where: { userId: req.user.sub } });
    const isManager = ["Admin", "Manager", "LocationHead"].includes(req.user.activeRole);

    if (!isManager && request.employeeId !== callerEmployee?.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (isManager && !await canAccessStation(req, request.employee.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.json({ success: true, data: request });
  } catch (err) {
    next(err);
  }
}

async function approveLeaveRequest(req, res, next) {
  try {
    const { id } = req.params;
    const { action, note } = req.body;

    if (!["approve", "reject"].includes(action)) {
      return res.status(422).json({ success: false, message: "action must be 'approve' or 'reject'" });
    }

    const request = await prisma.leaveRequest.findUnique({
      where: { id },
      include: { employee: true },
    });
    if (!request) return res.status(404).json({ success: false, message: "Leave request not found" });
    if (request.status !== "Pending") {
      return res.status(409).json({ success: false, message: `Request is already ${request.status.toLowerCase()}` });
    }

    if (!await canAccessStation(req, request.employee.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const newStatus = action === "approve" ? "Approved" : "Rejected";
    const year = request.startDate.getFullYear();

    const ops = [
      prisma.leaveRequest.update({
        where: { id },
        data: { status: newStatus, approvedBy: req.user.sub, approvedAt: new Date(), note: note || null },
      }),
      prisma.leaveBalance.update({
        where: { employeeId_leaveTypeId_year: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year } },
        data: action === "approve"
          ? { used: { increment: request.days }, pending: { decrement: request.days } }
          : { pending: { decrement: request.days } },
      }),
    ];

    const [updated] = await prisma.$transaction(ops);
    res.json({ success: true, message: `Leave request ${newStatus.toLowerCase()}`, data: updated });
  } catch (err) {
    next(err);
  }
}

async function cancelLeaveRequest(req, res, next) {
  try {
    const { id } = req.params;
    const request = await prisma.leaveRequest.findUnique({
      where: { id },
      include: { employee: true },
    });
    if (!request) return res.status(404).json({ success: false, message: "Leave request not found" });

    const callerEmployee = await prisma.employee.findUnique({ where: { userId: req.user.sub } });
    const isManager = ["Admin", "Manager", "LocationHead"].includes(req.user.activeRole);

    if (!isManager && request.employeeId !== callerEmployee?.id) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (isManager && !await canAccessStation(req, request.employee.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (!["Pending", "Approved"].includes(request.status)) {
      return res.status(409).json({ success: false, message: `Cannot cancel a ${request.status.toLowerCase()} request` });
    }

    const year = request.startDate.getFullYear();
    const wasApproved = request.status === "Approved";

    await prisma.$transaction([
      prisma.leaveRequest.update({ where: { id }, data: { status: "Cancelled" } }),
      prisma.leaveBalance.update({
        where: { employeeId_leaveTypeId_year: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year } },
        data: wasApproved ? { used: { decrement: request.days } } : { pending: { decrement: request.days } },
      }),
    ]);

    res.json({ success: true, message: "Leave request cancelled" });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listLeaveTypes, createLeaveType, updateLeaveType, deleteLeaveType,
  getLeaveBalances,
  listLeaveRequests, submitLeaveRequest, getLeaveRequest,
  approveLeaveRequest, cancelLeaveRequest,
};
