"use strict";
const prisma = require("../config/prisma");

// ── Leave Types ───────────────────────────────────────────────────────────────

async function listLeaveTypes(req, res, next) {
  try {
    const stationId = req.headers["x-station-id"] || req.query.stationId || "global";
    const where = stationId === "global"
      ? {}
      : { OR: [{ stationId }, { stationId: "global" }] };

    const types = await prisma.leaveType.findMany({
      where,
      orderBy: { name: "asc" },
    });
    res.json({ success: true, data: types });
  } catch (err) {
    next(err);
  }
}

async function createLeaveType(req, res, next) {
  try {
    const { name, daysAllowed = 21, isPaid = true } = req.body;
    const stationId = req.headers["x-station-id"] || req.query.stationId || "global";

    if (!name) return res.status(422).json({ success: false, message: "name is required" });

    const lt = await prisma.leaveType.create({
      data: { name: name.trim(), daysAllowed: parseInt(daysAllowed, 10), isPaid: Boolean(isPaid), stationId },
    });

    res.status(201).json({ success: true, message: "Leave type created", data: lt });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A leave type with this name already exists for this scope" });
    }
    next(err);
  }
}

async function updateLeaveType(req, res, next) {
  try {
    const { name, daysAllowed, isPaid, isActive } = req.body;
    const lt = await prisma.leaveType.findUnique({ where: { id: req.params.id } });
    if (!lt) return res.status(404).json({ success: false, message: "Leave type not found" });

    const updated = await prisma.leaveType.update({
      where: { id: req.params.id },
      data: {
        name: name ? name.trim() : undefined,
        daysAllowed: daysAllowed !== undefined ? parseInt(daysAllowed, 10) : undefined,
        isPaid: isPaid !== undefined ? Boolean(isPaid) : undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : undefined,
      },
    });

    res.json({ success: true, message: "Leave type updated", data: updated });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A leave type with this name already exists for this scope" });
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

    // If the caller is an employee (not manager/admin), scope to self
    const callerEmployee = await prisma.employee.findUnique({ where: { userId: req.user.sub } });
    const scopedEmployeeId = employeeId || callerEmployee?.id;

    if (!scopedEmployeeId) {
      return res.status(422).json({ success: false, message: "employeeId is required" });
    }

    const emp = await prisma.employee.findUnique({ where: { id: scopedEmployeeId } });
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

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
    const { status, employeeId, stationId: qStation, page = "1", limit = "25" } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    // Employees can only see their own requests
    const callerEmployee = await prisma.employee.findUnique({ where: { userId: req.user.sub } });
    const isManager = ["Admin", "Manager", "LocationHead"].includes(req.user.activeRole);

    const where = {};
    if (status) where.status = status;

    if (!isManager && callerEmployee) {
      where.employeeId = callerEmployee.id;
    } else if (employeeId) {
      where.employeeId = employeeId;
    } else if (qStation) {
      where.employee = { stationId: qStation };
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

    res.json({
      success: true,
      data: requests,
      meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
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
    const end = new Date(endDate);
    if (end < start) {
      return res.status(422).json({ success: false, message: "endDate must be on or after startDate" });
    }

    // Calculate business days (simple: calendar days excluding weekends)
    let days = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) days++;
      cursor.setDate(cursor.getDate() + 1);
    }

    const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType || !leaveType.isActive) {
      return res.status(404).json({ success: false, message: "Leave type not found or inactive" });
    }

    // Check balance
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

    // Check for overlapping approved/pending requests
    const overlap = await prisma.leaveRequest.findFirst({
      where: {
        employeeId: callerEmployee.id,
        status: { in: ["Pending", "Approved"] },
        OR: [
          { startDate: { lte: end }, endDate: { gte: start } },
        ],
      },
    });
    if (overlap) {
      return res.status(409).json({ success: false, message: "You have an overlapping leave request for this period" });
    }

    const [request] = await prisma.$transaction([
      prisma.leaveRequest.create({
        data: {
          employeeId: callerEmployee.id,
          leaveTypeId,
          startDate: start,
          endDate: end,
          days,
          reason: reason || null,
          status: "Pending",
        },
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
    const req_ = await prisma.leaveRequest.findUnique({
      where: { id: req.params.id },
      include: {
        employee: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } },
        leaveType: true,
      },
    });
    if (!req_) return res.status(404).json({ success: false, message: "Leave request not found" });
    res.json({ success: true, data: req_ });
  } catch (err) {
    next(err);
  }
}

// ── PUT /hr/leaves/:id/approve — approve or reject ────────────────────────────

async function approveLeaveRequest(req, res, next) {
  try {
    const { id } = req.params;
    const { action, note } = req.body; // action: "approve" | "reject"

    if (!["approve", "reject"].includes(action)) {
      return res.status(422).json({ success: false, message: "action must be 'approve' or 'reject'" });
    }

    const request = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ success: false, message: "Leave request not found" });
    if (request.status !== "Pending") {
      return res.status(409).json({ success: false, message: `Request is already ${request.status.toLowerCase()}` });
    }

    const newStatus = action === "approve" ? "Approved" : "Rejected";
    const year = request.startDate.getFullYear();

    const ops = [
      prisma.leaveRequest.update({
        where: { id },
        data: { status: newStatus, approvedBy: req.user.sub, approvedAt: new Date(), note: note || null },
      }),
    ];

    if (action === "approve") {
      ops.push(
        prisma.leaveBalance.update({
          where: { employeeId_leaveTypeId_year: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year } },
          data: { used: { increment: request.days }, pending: { decrement: request.days } },
        })
      );
    } else {
      // Rejected — release the pending days
      ops.push(
        prisma.leaveBalance.update({
          where: { employeeId_leaveTypeId_year: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year } },
          data: { pending: { decrement: request.days } },
        })
      );
    }

    const [updated] = await prisma.$transaction(ops);
    res.json({ success: true, message: `Leave request ${newStatus.toLowerCase()}`, data: updated });
  } catch (err) {
    next(err);
  }
}

// ── PUT /hr/leaves/:id/cancel ────────────────────────────────────────────────

async function cancelLeaveRequest(req, res, next) {
  try {
    const { id } = req.params;
    const request = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ success: false, message: "Leave request not found" });

    // Employees can only cancel their own pending requests
    const callerEmployee = await prisma.employee.findUnique({ where: { userId: req.user.sub } });
    const isManager = ["Admin", "Manager", "LocationHead"].includes(req.user.activeRole);

    if (!isManager && request.employeeId !== callerEmployee?.id) {
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
        data: wasApproved
          ? { used: { decrement: request.days } }
          : { pending: { decrement: request.days } },
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
