"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const {
  createDepartmentRules, createJobTitleRules, createShiftPatternRules,
  createLeaveTypeRules, submitLeaveRequestRules, approveLeaveRules,
  onboardEmployeeRules, validate,
} = require("../utils/validators");

const setup       = require("../controllers/hrSetupController");
const employees   = require("../controllers/hrEmployeesController");
const documents   = require("../controllers/hrDocumentsController");
const leaves      = require("../controllers/hrLeavesController");
const attendance  = require("../controllers/hrAttendanceController");
const self        = require("../controllers/hrSelfController");
const payroll     = require("../controllers/hrPayrollController");
const performance = require("../controllers/hrPerformanceController");
const holidays    = require("../controllers/hrHolidaysController");

const router = Router();

// All HR routes require authentication
router.use(authenticate);

// ── Self-service routes (authenticate only — no requirePermission) ─────────────
// Any authenticated user with an Employee record can access these.

router.get   ("/self/me",                   self.getMe);
router.get   ("/self/attendance",           self.getMyAttendance);
router.post  ("/self/attendance/checkin",   self.checkIn);
router.post  ("/self/attendance/checkout",  self.checkOut);
router.get   ("/self/leaves/types",         self.getLeaveTypes);
router.get   ("/self/leaves/balances",      self.getMyLeaveBalances);
router.get   ("/self/leaves",               self.getMyLeaves);
router.post  ("/self/leaves",               self.submitLeave);
router.put   ("/self/leaves/:id/cancel",    self.cancelLeave);
router.get   ("/self/shifts",               self.getMyShifts);
router.get   ("/self/disciplinary",         self.getMyDisciplinary);
router.get   ("/self/payroll",              self.getMyPayroll);
router.get   ("/self/performance",          self.getMyPerformance);

// ── Business Setup ────────────────────────────────────────────────────────────

// Departments
router.get   ("/setup/departments",      requirePermission("hr.staff.view"),                                              setup.listDepartments);
router.post  ("/setup/departments",      requirePermission("hr.setup.departments"), createDepartmentRules, validate,      setup.createDepartment);
router.get   ("/setup/departments/tree", requirePermission("hr.staff.view"),                                              setup.getOrgChart);
router.get   ("/setup/departments/:id",  requirePermission("hr.staff.view"),                                              setup.getDepartment);
router.put   ("/setup/departments/:id",  requirePermission("hr.setup.departments"),                                       setup.updateDepartment);
router.delete("/setup/departments/:id",  requirePermission("hr.setup.departments"),                                       setup.deleteDepartment);

// Job Titles
router.get   ("/setup/job-titles",      requirePermission("hr.staff.view"),                                              setup.listJobTitles);
router.post  ("/setup/job-titles",      requirePermission("hr.setup.jobtitles"),  createJobTitleRules, validate,         setup.createJobTitle);
router.get   ("/setup/job-titles/:id",  requirePermission("hr.staff.view"),                                              setup.getJobTitle);
router.put   ("/setup/job-titles/:id",  requirePermission("hr.setup.jobtitles"),                                         setup.updateJobTitle);
router.delete("/setup/job-titles/:id",  requirePermission("hr.setup.jobtitles"),                                         setup.deleteJobTitle);

// Station Modules
router.get("/setup/stations/:stationId/modules", requirePermission("hr.staff.view"),              setup.getStationModules);
router.put("/setup/stations/:stationId/modules", requirePermission("stations.modules.configure"),  setup.updateStationModules);

// ── Employees ─────────────────────────────────────────────────────────────────

router.get   ("/employees",                      requirePermission("hr.staff.view"),                              employees.listEmployees);
router.post  ("/employees",                      requirePermission("hr.staff.create"), onboardEmployeeRules, validate, employees.createEmployee);
router.get   ("/employees/:id",                  requirePermission("hr.staff.view"),      employees.getEmployee);
router.put   ("/employees/:id",                  requirePermission("hr.staff.edit"),      employees.updateEmployee);
router.post  ("/employees/:id/terminate",        requirePermission("hr.staff.terminate"), employees.terminateEmployee);

// Documents
router.get   ("/documents",         requirePermission("hr.staff.view"),   documents.listDocuments);
router.post  ("/documents",         requirePermission("hr.staff.edit"),   documents.createDocument);
router.get   ("/documents/:id",     requirePermission("hr.staff.view"),   documents.getDocument);
router.get   ("/documents/:id/download", requirePermission("hr.staff.view"), documents.downloadDocument);
router.put   ("/documents/:id",     requirePermission("hr.staff.edit"),   documents.updateDocument);
router.delete("/documents/:id",     requirePermission("hr.staff.edit"),   documents.deleteDocument);

// Disciplinary — station-level list
router.get   ("/disciplinary",                         requirePermission("hr.disciplinary.view"),    employees.listAllDisciplinaryRecords);

// Disciplinary — per-employee
router.get   ("/employees/:id/disciplinary",           requirePermission("hr.disciplinary.view"),    employees.listDisciplinaryRecords);
router.post  ("/employees/:id/disciplinary",           requirePermission("hr.disciplinary.record"),  employees.createDisciplinaryRecord);
router.put   ("/employees/:id/disciplinary/:recordId", requirePermission("hr.disciplinary.record"),  employees.updateDisciplinaryRecord);

// ── Leave Management ──────────────────────────────────────────────────────────

// Public holidays
router.get   ("/holidays",     requirePermission("hr.leaves.view"),       holidays.listHolidays);
router.post  ("/holidays",     requirePermission("hr.setup.holidays"),    holidays.createHoliday);
router.put   ("/holidays/:id", requirePermission("hr.setup.holidays"),    holidays.updateHoliday);
router.delete("/holidays/:id", requirePermission("hr.setup.holidays"),    holidays.deleteHoliday);

// Leave types (admin/manager configure, all can view)
router.get   ("/leaves/types",       requirePermission("hr.leaves.view"),       leaves.listLeaveTypes);
router.post  ("/leaves/types",       requirePermission("hr.setup.leavetypes"), createLeaveTypeRules, validate, leaves.createLeaveType);
router.put   ("/leaves/types/:id",   requirePermission("hr.setup.leavetypes"),  leaves.updateLeaveType);
router.delete("/leaves/types/:id",   requirePermission("hr.setup.leavetypes"),  leaves.deleteLeaveType);

// Leave balances
router.get("/leaves/balances",       requirePermission("hr.leaves.view"),       leaves.getLeaveBalances);

// Leave requests
router.get   ("/leaves",             requirePermission("hr.leaves.view"),        leaves.listLeaveRequests);
router.post  ("/leaves",             requirePermission("hr.leaves.view"),    submitLeaveRequestRules, validate, leaves.submitLeaveRequest);
router.get   ("/leaves/:id",         requirePermission("hr.leaves.view"),                                    leaves.getLeaveRequest);
router.put   ("/leaves/:id/approve", requirePermission("hr.leaves.approve"),  approveLeaveRules, validate,  leaves.approveLeaveRequest);
router.put   ("/leaves/:id/cancel",  requirePermission("hr.leaves.view"),        leaves.cancelLeaveRequest);

// ── Shifts ────────────────────────────────────────────────────────────────────

router.get   ("/shifts",                  requirePermission("hr.shifts.view"),   attendance.listShiftPatterns);
router.post  ("/shifts",                  requirePermission("hr.setup.shifts"),  createShiftPatternRules, validate, attendance.createShiftPattern);
router.put   ("/shifts/:id",              requirePermission("hr.setup.shifts"),   attendance.updateShiftPattern);
router.delete("/shifts/:id",              requirePermission("hr.setup.shifts"),   attendance.deleteShiftPattern);

// Shift assignments
router.get   ("/shifts/assignments",      requirePermission("hr.shifts.view"),   attendance.listShiftAssignments);
router.post  ("/shifts/assignments",      requirePermission("hr.shifts.manage"),  attendance.assignShift);

// ── Attendance ────────────────────────────────────────────────────────────────

router.get   ("/attendance",             requirePermission("hr.attendance.view"),    attendance.listAttendance);
router.post  ("/attendance/checkin",     requirePermission("hr.attendance.view"),    attendance.checkIn);
router.post  ("/attendance/checkout",    requirePermission("hr.attendance.view"),    attendance.checkOut);
router.post  ("/attendance/manual",      requirePermission("hr.attendance.record"),  attendance.upsertAttendance);

// ── Payroll ───────────────────────────────────────────────────────────────────

router.get   ("/payroll",       requirePermission("hr.payroll.view"),    payroll.listPayrolls);
router.post  ("/payroll",       requirePermission("hr.payroll.process"), payroll.createPayroll);
router.put   ("/payroll/:id",   requirePermission("hr.payroll.process"), payroll.updatePayroll);
router.delete("/payroll/:id",   requirePermission("hr.payroll.process"), payroll.deletePayroll);

// ── Performance Tasks ─────────────────────────────────────────────────────────

router.get   ("/performance",       requirePermission("hr.performance.view"),   performance.listTasks);
router.post  ("/performance",       requirePermission("hr.performance.manage"), performance.createTask);
router.put   ("/performance/:id",   requirePermission("hr.performance.manage"), performance.updateTask);
router.delete("/performance/:id",   requirePermission("hr.performance.manage"), performance.deleteTask);

module.exports = router;
