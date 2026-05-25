"use strict";
const bcrypt = require("bcryptjs");
const prisma = require("../config/prisma");
const { config } = require("../config/env");

const EMPLOYMENT_TYPES = ["FullTime", "PartTime", "Contract", "Intern"];
const CONTRACT_TYPES   = ["Permanent", "Fixed-Term", "Casual"];
const GENDERS          = ["Male", "Female", "Other"];

// ── Employee summary shape ─────────────────────────────────────────────────────

async function buildEmployeeSummary(emp) {
  return {
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
    salaryGrade: emp.salaryGrade,
    basicSalary: emp.basicSalary,
    status: emp.status,
    terminatedAt: emp.terminatedAt,
    terminationNote: emp.terminationNote,
    createdAt: emp.createdAt,
    updatedAt: emp.updatedAt,
    user: emp.user ? {
      id: emp.user.id,
      name: emp.user.name,
      email: emp.user.email,
      phone: emp.user.phone,
      activeRole: emp.user.activeRole,
      status: emp.user.status,
    } : undefined,
    department: emp.department ? { id: emp.department.id, name: emp.department.name } : null,
    jobTitle: emp.jobTitle ? { id: emp.jobTitle.id, title: emp.jobTitle.title, grade: emp.jobTitle.grade } : null,
  };
}

const EMPLOYEE_INCLUDE = {
  user: { select: { id: true, name: true, email: true, phone: true, activeRole: true, status: true } },
  department: { select: { id: true, name: true } },
  jobTitle: { select: { id: true, title: true, grade: true } },
};

// ── GET /hr/employees ─────────────────────────────────────────────────────────

async function listEmployees(req, res, next) {
  try {
    const { status, departmentId, stationId: qStation, page = "1", limit = "25" } = req.query;
    const stationId = req.headers["x-station-id"] || qStation;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));

    const where = {};
    if (status) where.status = status;
    if (departmentId) where.departmentId = departmentId;
    if (stationId) where.stationId = stationId;

    const [employees, total] = await prisma.$transaction([
      prisma.employee.findMany({
        where,
        include: EMPLOYEE_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.employee.count({ where }),
    ]);

    const data = await Promise.all(employees.map(buildEmployeeSummary));
    res.json({ success: true, data, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) {
    next(err);
  }
}

// ── POST /hr/employees (onboard) ──────────────────────────────────────────────
// Creates a User account + Employee record in one transaction.
// If userId is provided, links to an existing user instead.

async function createEmployee(req, res, next) {
  try {
    const {
      // User fields (required if not linking existing userId)
      userId,
      email, password, name, phone,
      // Employee fields
      employeeNumber, stationId,
      departmentId, jobTitleId,
      employmentType = "FullTime", contractType,
      startDate,
      endDate,
      nationalId, dateOfBirth, gender, address,
      emergencyContact, bankDetails,
      salaryGrade, basicSalary,
    } = req.body;

    if (!stationId) return res.status(422).json({ success: false, message: "stationId is required" });
    if (!startDate) return res.status(422).json({ success: false, message: "startDate is required" });
    if (!EMPLOYMENT_TYPES.includes(employmentType)) {
      return res.status(422).json({ success: false, message: `employmentType must be one of: ${EMPLOYMENT_TYPES.join(", ")}` });
    }
    if (gender && !GENDERS.includes(gender)) {
      return res.status(422).json({ success: false, message: `gender must be one of: ${GENDERS.join(", ")}` });
    }

    // Verify station exists
    const station = await prisma.station.findUnique({ where: { id: stationId } });
    if (!station) return res.status(404).json({ success: false, message: "Station not found" });

    // Generate or validate employee number
    let empNumber = employeeNumber?.trim();
    if (!empNumber) {
      const count = await prisma.employee.count();
      empNumber = `EMP-${String(count + 1).padStart(4, "0")}`;
    } else {
      const existing = await prisma.employee.findUnique({ where: { employeeNumber: empNumber } });
      if (existing) return res.status(409).json({ success: false, message: "Employee number already in use" });
    }

    let resolvedUserId = userId;

    if (!resolvedUserId) {
      // Create a new User account
      if (!email || !name) {
        return res.status(422).json({ success: false, message: "email and name are required when not linking an existing user" });
      }
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(409).json({ success: false, message: "A user with this email already exists" });
      }
      const rawPassword = password || `${name.split(" ")[0]}@${new Date().getFullYear()}`;
      const hashed = await bcrypt.hash(rawPassword, config.bcryptRounds);

      const newUser = await prisma.user.create({
        data: {
          email,
          password: hashed,
          name,
          phone: phone || undefined,
          employeeId: empNumber,
          isEmployee: true,
          activeRole: "Employee",
          homeLocation: stationId,
          status: "Active",
        },
      });

      // Assign Employee role
      const empRole = await prisma.role.findUnique({ where: { name: "Employee" } });
      if (empRole) {
        await prisma.userRole.create({ data: { userId: newUser.id, roleId: empRole.id, stationId: "global" } });
      }

      resolvedUserId = newUser.id;
    } else {
      // Link existing user — verify they don't already have an employee record
      const user = await prisma.user.findUnique({ where: { id: resolvedUserId } });
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      const alreadyEmployee = await prisma.employee.findUnique({ where: { userId: resolvedUserId } });
      if (alreadyEmployee) {
        return res.status(409).json({ success: false, message: "This user is already linked to an employee record" });
      }

      await prisma.user.update({
        where: { id: resolvedUserId },
        data: { isEmployee: true, employeeId: empNumber, homeLocation: stationId },
      });
    }

    const employee = await prisma.employee.create({
      data: {
        userId: resolvedUserId,
        employeeNumber: empNumber,
        stationId,
        departmentId: departmentId || null,
        jobTitleId: jobTitleId || null,
        employmentType,
        contractType: contractType || null,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        nationalId: nationalId || null,
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        gender: gender || null,
        address: address || null,
        emergencyContact: emergencyContact ? JSON.stringify(emergencyContact) : null,
        bankDetails: bankDetails ? JSON.stringify(bankDetails) : null,
        salaryGrade: salaryGrade || null,
        basicSalary: basicSalary ? parseFloat(basicSalary) : null,
        status: "Active",
      },
      include: EMPLOYEE_INCLUDE,
    });

    // Seed leave balances from active leave types
    const leaveTypes = await prisma.leaveType.findMany({
      where: { isActive: true, OR: [{ stationId }, { stationId: "global" }] },
    });
    const year = new Date().getFullYear();
    for (const lt of leaveTypes) {
      await prisma.leaveBalance.create({
        data: { employeeId: employee.id, leaveTypeId: lt.id, year, total: lt.daysAllowed },
      });
    }

    res.status(201).json({
      success: true,
      message: "Employee onboarded successfully",
      data: await buildEmployeeSummary(employee),
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /hr/employees/:id ─────────────────────────────────────────────────────

async function getEmployee(req, res, next) {
  try {
    const emp = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: {
        ...EMPLOYEE_INCLUDE,
        leaveBalances: { include: { leaveType: { select: { id: true, name: true, isPaid: true } } } },
        shiftAssignments: {
          include: { shiftPattern: { select: { id: true, name: true, startTime: true, endTime: true } } },
          orderBy: { date: "desc" },
          take: 10,
        },
      },
    });
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });
    res.json({ success: true, data: await buildEmployeeSummary(emp) });
  } catch (err) {
    next(err);
  }
}

// ── PUT /hr/employees/:id ─────────────────────────────────────────────────────

async function updateEmployee(req, res, next) {
  try {
    const { id } = req.params;
    const {
      departmentId, jobTitleId, stationId,
      employmentType, contractType,
      startDate, endDate,
      nationalId, dateOfBirth, gender, address,
      emergencyContact, bankDetails,
      salaryGrade, basicSalary,
    } = req.body;

    const emp = await prisma.employee.findUnique({ where: { id } });
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });
    if (emp.status === "Terminated") {
      return res.status(409).json({ success: false, message: "Cannot edit a terminated employee" });
    }

    if (employmentType && !EMPLOYMENT_TYPES.includes(employmentType)) {
      return res.status(422).json({ success: false, message: `employmentType must be one of: ${EMPLOYMENT_TYPES.join(", ")}` });
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: {
        departmentId: departmentId !== undefined ? (departmentId || null) : undefined,
        jobTitleId: jobTitleId !== undefined ? (jobTitleId || null) : undefined,
        stationId: stationId || undefined,
        employmentType: employmentType || undefined,
        contractType: contractType !== undefined ? (contractType || null) : undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate !== undefined ? (endDate ? new Date(endDate) : null) : undefined,
        nationalId: nationalId !== undefined ? (nationalId || null) : undefined,
        dateOfBirth: dateOfBirth !== undefined ? (dateOfBirth ? new Date(dateOfBirth) : null) : undefined,
        gender: gender !== undefined ? (gender || null) : undefined,
        address: address !== undefined ? (address || null) : undefined,
        emergencyContact: emergencyContact !== undefined ? (emergencyContact ? JSON.stringify(emergencyContact) : null) : undefined,
        bankDetails: bankDetails !== undefined ? (bankDetails ? JSON.stringify(bankDetails) : null) : undefined,
        salaryGrade: salaryGrade !== undefined ? (salaryGrade || null) : undefined,
        basicSalary: basicSalary !== undefined ? (basicSalary ? parseFloat(basicSalary) : null) : undefined,
      },
      include: EMPLOYEE_INCLUDE,
    });

    res.json({ success: true, message: "Employee updated", data: await buildEmployeeSummary(updated) });
  } catch (err) {
    next(err);
  }
}

// ── POST /hr/employees/:id/terminate ─────────────────────────────────────────

async function terminateEmployee(req, res, next) {
  try {
    const { id } = req.params;
    const { note, terminatedAt } = req.body;

    const emp = await prisma.employee.findUnique({ where: { id }, include: { user: true } });
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });
    if (emp.status === "Terminated") {
      return res.status(409).json({ success: false, message: "Employee is already terminated" });
    }

    const terminationDate = terminatedAt ? new Date(terminatedAt) : new Date();

    await prisma.$transaction([
      prisma.employee.update({
        where: { id },
        data: { status: "Terminated", terminatedAt: terminationDate, terminationNote: note || null },
      }),
      prisma.user.update({
        where: { id: emp.userId },
        data: { status: "Inactive" },
      }),
    ]);

    res.json({ success: true, message: "Employee terminated", data: { id, terminatedAt: terminationDate } });
  } catch (err) {
    next(err);
  }
}

// ── GET/POST /hr/employees/:id/disciplinary ───────────────────────────────────

async function listDisciplinaryRecords(req, res, next) {
  try {
    const emp = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    const records = await prisma.disciplinaryRecord.findMany({
      where: { employeeId: req.params.id },
      orderBy: { date: "desc" },
    });

    res.json({ success: true, data: records });
  } catch (err) {
    next(err);
  }
}

async function createDisciplinaryRecord(req, res, next) {
  try {
    const { id: employeeId } = req.params;
    const { type, description, date } = req.body;

    const DISC_TYPES = ["Warning", "Suspension", "Termination"];
    if (!DISC_TYPES.includes(type)) {
      return res.status(422).json({ success: false, message: `type must be one of: ${DISC_TYPES.join(", ")}` });
    }
    if (!description) return res.status(422).json({ success: false, message: "description is required" });

    const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    const record = await prisma.disciplinaryRecord.create({
      data: {
        employeeId,
        type,
        description,
        date: date ? new Date(date) : new Date(),
        recordedBy: req.user.sub,
      },
    });

    res.status(201).json({ success: true, message: "Disciplinary record added", data: record });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listEmployees,
  createEmployee,
  getEmployee,
  updateEmployee,
  terminateEmployee,
  listDisciplinaryRecords,
  createDisciplinaryRecord,
};
