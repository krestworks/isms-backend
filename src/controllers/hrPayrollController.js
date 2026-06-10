"use strict";
const prisma = require("../config/prisma");
const { resolveStation, canAccessStation } = require("../middleware/station");

const EMPLOYEE_SELECT = {
  id: true,
  employeeNumber: true,
  stationId: true,
  user: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  jobTitle: { select: { id: true, title: true } },
};

// ── GET /hr/payroll ───────────────────────────────────────────────────────────

async function listPayrolls(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const { employeeId, month, status, page = "1", limit = "50" } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const where = {};
    if (stationId)  where.stationId  = stationId;
    if (employeeId) where.employeeId = employeeId;
    if (month)      where.month      = month;
    if (status)     where.status     = status;

    const [payrolls, total] = await prisma.$transaction([
      prisma.payroll.findMany({
        where,
        include: { employee: { select: EMPLOYEE_SELECT } },
        orderBy: [{ month: "desc" }, { createdAt: "desc" }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.payroll.count({ where }),
    ]);

    res.json({ success: true, data: payrolls, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) {
    next(err);
  }
}

// ── POST /hr/payroll ──────────────────────────────────────────────────────────

async function createPayroll(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const {
      employeeId, month,
      basicSalary = 0, houseAllowance = 0, transportAllowance = 0, overtimePay = 0,
      nhif = 0, nssf = 0, paye = 0, otherDeductions = 0,
      status = "pending", payDate,
    } = req.body;

    if (!employeeId) return res.status(422).json({ success: false, message: "employeeId is required" });
    if (!month)      return res.status(422).json({ success: false, message: "month is required (YYYY-MM)" });

    const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });
    if (!await canAccessStation(req, emp.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const gross = basicSalary + houseAllowance + transportAllowance + overtimePay;
    const deductions = nhif + nssf + paye + otherDeductions;
    const net = gross - deductions;

    const payroll = await prisma.payroll.create({
      data: {
        stationId: stationId || emp.stationId,
        employeeId,
        month,
        basicSalary:        parseFloat(basicSalary),
        houseAllowance:     parseFloat(houseAllowance),
        transportAllowance: parseFloat(transportAllowance),
        overtimePay:        parseFloat(overtimePay),
        grossPay:           gross,
        nhif:               parseFloat(nhif),
        nssf:               parseFloat(nssf),
        paye:               parseFloat(paye),
        otherDeductions:    parseFloat(otherDeductions),
        totalDeductions:    deductions,
        netPay:             net,
        status,
        payDate: payDate || null,
      },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });

    res.status(201).json({ success: true, data: payroll });
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ success: false, message: "Payroll for this employee and month already exists" });
    next(err);
  }
}

// ── PUT /hr/payroll/:id ───────────────────────────────────────────────────────

async function updatePayroll(req, res, next) {
  try {
    const { id } = req.params;
    const rec = await prisma.payroll.findUnique({ where: { id } });
    if (!rec) return res.status(404).json({ success: false, message: "Payroll record not found" });
    if (!await canAccessStation(req, rec.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const {
      basicSalary, houseAllowance, transportAllowance, overtimePay,
      nhif, nssf, paye, otherDeductions,
      status, payDate,
    } = req.body;

    const bs  = basicSalary        !== undefined ? parseFloat(basicSalary)        : rec.basicSalary;
    const ha  = houseAllowance     !== undefined ? parseFloat(houseAllowance)     : rec.houseAllowance;
    const ta  = transportAllowance !== undefined ? parseFloat(transportAllowance) : rec.transportAllowance;
    const op  = overtimePay        !== undefined ? parseFloat(overtimePay)        : rec.overtimePay;
    const nh  = nhif               !== undefined ? parseFloat(nhif)               : rec.nhif;
    const ns  = nssf               !== undefined ? parseFloat(nssf)               : rec.nssf;
    const pa  = paye               !== undefined ? parseFloat(paye)               : rec.paye;
    const od  = otherDeductions    !== undefined ? parseFloat(otherDeductions)    : rec.otherDeductions;

    const gross      = bs + ha + ta + op;
    const deductions = nh + ns + pa + od;

    const updated = await prisma.payroll.update({
      where: { id },
      data: {
        basicSalary: bs, houseAllowance: ha, transportAllowance: ta, overtimePay: op,
        grossPay: gross,
        nhif: nh, nssf: ns, paye: pa, otherDeductions: od,
        totalDeductions: deductions,
        netPay: gross - deductions,
        status:  status  !== undefined ? status  : undefined,
        payDate: payDate !== undefined ? payDate : undefined,
      },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /hr/payroll/:id ────────────────────────────────────────────────────

async function deletePayroll(req, res, next) {
  try {
    const { id } = req.params;
    const rec = await prisma.payroll.findUnique({ where: { id } });
    if (!rec) return res.status(404).json({ success: false, message: "Payroll record not found" });
    if (!await canAccessStation(req, rec.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    await prisma.payroll.delete({ where: { id } });
    res.json({ success: true, data: { id } });
  } catch (err) {
    next(err);
  }
}

module.exports = { listPayrolls, createPayroll, updatePayroll, deletePayroll };
