"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const {
  createDepartmentRules, createJobTitleRules, createShiftPatternRules,
  createLeaveTypeRules, submitLeaveRequestRules, approveLeaveRules,
  onboardEmployeeRules, validate,
} = require("../utils/validators");

const setup      = require("../controllers/hrSetupController");
const employees  = require("../controllers/hrEmployeesController");
const leaves     = require("../controllers/hrLeavesController");
const attendance = require("../controllers/hrAttendanceController");

const router = Router();

// All HR routes require authentication
router.use(authenticate);

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

// Disciplinary
router.get   ("/employees/:id/disciplinary",     requirePermission("hr.disciplinary.view"),   employees.listDisciplinaryRecords);
router.post  ("/employees/:id/disciplinary",     requirePermission("hr.disciplinary.record"),  employees.createDisciplinaryRecord);

// ── Leave Management ──────────────────────────────────────────────────────────

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

module.exports = router;
