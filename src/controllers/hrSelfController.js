"use strict";
// Self-service HR controller — employee portal endpoints.
// Requires only authentication (JWT). No hr.* permission codes needed.
// Each function scopes itself to the caller's own Employee record via userId.
const prisma = require("../config/prisma");

const EMPLOYEE_INCLUDE = {
  user: { select: { id: true, name: true, email: true, phone: true, activeRole: true, status: true } },
  department: { select: { id: true, name: true } },
  jobTitle: { select: { id: true, title: true, grade: true } },
};

async function resolveEmployee(userId) {
  return prisma.employee.findUnique({ where: { userId }, include: EMPLOYEE_INCLUDE });
}

// ── GET /hr/self/me ───────────────────────────────────────────────────────────

async function getMe(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) {
      return res.status(404).json({ success: false, message: "No employee record linked to your account. Contact HR." });
    }
    res.json({
      success: true,
      data: {
        id: emp.id,
        employeeNumber: emp.employeeNumber,
        stationId: emp.stationId,
        employmentType: emp.employmentType,
        contractType: emp.contractType,
        startDate: emp.startDate,
        endDate: emp.endDate,
        gender: emp.gender,
        nationalId: emp.nationalId,
        dateOfBirth: emp.dateOfBirth,
        address: emp.address,
        emergencyContact: emp.emergencyContact ? JSON.parse(emp.emergencyContact) : null,
        bankDetails:      emp.bankDetails      ? JSON.parse(emp.bankDetails)      : null,
        salaryGrade: emp.salaryGrade,
        basicSalary: emp.basicSalary,
        status: emp.status,
        user: emp.user,
        department: emp.department,
        jobTitle: emp.jobTitle,
        createdAt: emp.createdAt,
        updatedAt: emp.updatedAt,
      },
    });
  } catch (err) { next(err); }
}

// ── GET /hr/self/attendance ───────────────────────────────────────────────────

async function getMyAttendance(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });

    const { from, to, page = "1", limit = "60" } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 60));

    const where = { employeeId: emp.id };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to)   where.date.lte = new Date(to);
    }

    const [records, total] = await prisma.$transaction([
      prisma.attendance.findMany({
        where, orderBy: { date: "desc" },
        skip: (pageNum - 1) * limitNum, take: limitNum,
      }),
      prisma.attendance.count({ where }),
    ]);

    res.json({ success: true, data: records, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) { next(err); }
}

// ── POST /hr/self/attendance/checkin ─────────────────────────────────────────

async function checkIn(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: emp.id, date: today } },
    });
    if (existing?.checkIn) return res.status(409).json({ success: false, message: "You have already checked in today" });

    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: emp.id, date: today } },
      update: { checkIn: new Date(), status: "Present" },
      create: { employeeId: emp.id, date: today, checkIn: new Date(), status: "Present" },
    });

    res.json({ success: true, message: "Checked in", data: record });
  } catch (err) { next(err); }
}

// ── POST /hr/self/attendance/checkout ────────────────────────────────────────

async function checkOut(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const existing = await prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: emp.id, date: today } },
    });
    if (!existing?.checkIn) return res.status(409).json({ success: false, message: "You have not checked in today" });
    if (existing.checkOut)  return res.status(409).json({ success: false, message: "You have already checked out today" });

    const record = await prisma.attendance.update({
      where: { id: existing.id },
      data: { checkOut: new Date(), status: "Present" },
    });

    res.json({ success: true, message: "Checked out", data: record });
  } catch (err) { next(err); }
}

// ── GET /hr/self/leaves ───────────────────────────────────────────────────────

async function getMyLeaves(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });

    const { status, page = "1", limit = "50" } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const where = { employeeId: emp.id };
    if (status) where.status = status;

    const [requests, total] = await prisma.$transaction([
      prisma.leaveRequest.findMany({
        where,
        include: { leaveType: { select: { id: true, name: true, isPaid: true } } },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum, take: limitNum,
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    res.json({ success: true, data: requests, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) { next(err); }
}

// ── GET /hr/self/leaves/types ─────────────────────────────────────────────────

async function getLeaveTypes(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });

    const types = await prisma.leaveType.findMany({
      where: { OR: [{ stationId: emp.stationId }, { stationId: "global" }], isActive: true },
      orderBy: { name: "asc" },
    });

    res.json({ success: true, data: types });
  } catch (err) { next(err); }
}

// ── GET /hr/self/leaves/balances ──────────────────────────────────────────────

async function getMyLeaveBalances(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });

    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const balances = await prisma.leaveBalance.findMany({
      where: { employeeId: emp.id, year },
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
  } catch (err) { next(err); }
}

// ── POST /hr/self/leaves ──────────────────────────────────────────────────────

async function submitLeave(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });
    if (emp.status !== "Active") return res.status(409).json({ success: false, message: "Only active employees can submit leave requests" });

    const { leaveTypeId, startDate, endDate, reason } = req.body;
    if (!leaveTypeId || !startDate || !endDate) {
      return res.status(422).json({ success: false, message: "leaveTypeId, startDate, and endDate are required" });
    }

    const start = new Date(startDate);
    const end   = new Date(endDate);
    if (end < start) return res.status(422).json({ success: false, message: "endDate must be on or after startDate" });

    let days = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) days++;
      cursor.setDate(cursor.getDate() + 1);
    }

    const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType || !leaveType.isActive) return res.status(404).json({ success: false, message: "Leave type not found or inactive" });

    const year = start.getFullYear();
    const balance = await prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId, year } },
    });
    if (!balance) return res.status(409).json({ success: false, message: `No ${leaveType.name} balance found for ${year}. Contact HR to allocate leave.` });

    const available = balance.total - balance.used - balance.pending;
    if (days > available) {
      return res.status(409).json({ success: false, message: `Insufficient balance. Requested: ${days} days, Available: ${available} days` });
    }

    const overlap = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: emp.id,
        status: { in: ["Pending", "Approved"] },
        OR: [{ startDate: { lte: end }, endDate: { gte: start } }],
      },
    });
    if (overlap) return res.status(409).json({ success: false, message: "You have an overlapping leave request for this period" });

    const [request] = await prisma.$transaction([
      prisma.leaveRequest.create({
        data: { employeeId: emp.id, leaveTypeId, startDate: start, endDate: end, days, reason: reason || null, status: "Pending" },
        include: { leaveType: { select: { id: true, name: true, isPaid: true } } },
      }),
      prisma.leaveBalance.update({
        where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId, year } },
        data: { pending: { increment: days } },
      }),
    ]);

    res.status(201).json({ success: true, message: "Leave request submitted", data: request });
  } catch (err) { next(err); }
}

// ── PUT /hr/self/leaves/:id/cancel ───────────────────────────────────────────

async function cancelLeave(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });

    const request = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!request) return res.status(404).json({ success: false, message: "Leave request not found" });
    if (request.employeeId !== emp.id) return res.status(403).json({ success: false, message: "Not your leave request" });
    if (request.status !== "Pending") return res.status(409).json({ success: false, message: "Only pending requests can be cancelled" });

    await prisma.$transaction([
      prisma.leaveRequest.update({ where: { id: request.id }, data: { status: "Cancelled" } }),
      prisma.leaveBalance.update({
        where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: request.leaveTypeId, year: new Date(request.startDate).getFullYear() } },
        data: { pending: { decrement: request.days } },
      }),
    ]);

    res.json({ success: true, message: "Leave request cancelled" });
  } catch (err) { next(err); }
}

// ── GET /hr/self/shifts ───────────────────────────────────────────────────────

async function getMyShifts(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });

    const { from, to, page = "1", limit = "60" } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 60));

    const where = { employeeId: emp.id };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to)   where.date.lte = new Date(to);
    }

    const [assignments, total] = await prisma.$transaction([
      prisma.shiftAssignment.findMany({
        where,
        include: { shiftPattern: { select: { id: true, name: true, startTime: true, endTime: true } } },
        orderBy: { date: "desc" },
        skip: (pageNum - 1) * limitNum, take: limitNum,
      }),
      prisma.shiftAssignment.count({ where }),
    ]);

    res.json({ success: true, data: assignments, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) { next(err); }
}

// ── GET /hr/self/disciplinary ─────────────────────────────────────────────────

async function getMyDisciplinary(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });

    const records = await prisma.disciplinaryRecord.findMany({
      where: { employeeId: emp.id },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: records });
  } catch (err) { next(err); }
}

// ── GET /hr/self/payroll ──────────────────────────────────────────────────────

async function getMyPayroll(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });

    const { page = "1", limit = "24" } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(60, Math.max(1, parseInt(limit, 10) || 24));

    const where = { employeeId: emp.id };
    const [records, total] = await prisma.$transaction([
      prisma.payroll.findMany({
        where,
        orderBy: { month: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.payroll.count({ where }),
    ]);

    res.json({ success: true, data: records, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) { next(err); }
}

// ── GET /hr/self/performance ──────────────────────────────────────────────────

async function getMyPerformance(req, res, next) {
  try {
    const emp = await resolveEmployee(req.user.sub);
    if (!emp) return res.status(404).json({ success: false, message: "No employee record linked to your account" });

    const { page = "1", limit = "50" } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const where = { employeeId: emp.id };
    const [tasks, total] = await prisma.$transaction([
      prisma.performanceTask.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.performanceTask.count({ where }),
    ]);

    res.json({ success: true, data: tasks, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) { next(err); }
}

module.exports = {
  getMe,
  getMyAttendance, checkIn, checkOut,
  getMyLeaves, getLeaveTypes, getMyLeaveBalances, submitLeave, cancelLeave,
  getMyShifts,
  getMyDisciplinary,
  getMyPayroll,
  getMyPerformance,
};
