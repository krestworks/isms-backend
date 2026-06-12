"use strict";
const { body, validationResult } = require("express-validator");

const VALID_ROLES = ["Admin", "Manager", "LocationHead", "Accountant", "Attendant", "Employee"];

// ── auth ─────────────────────────────────────────────────────────────────────

const loginRules = [
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
  body("password").isLength({ min: 1 }).withMessage("Password is required"),
];

const changePasswordRules = [
  body("currentPassword").isLength({ min: 1 }).withMessage("Current password is required"),
  body("newPassword")
    .isLength({ min: 8 }).withMessage("New password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage("New password must contain uppercase, lowercase, and a number"),
];

const forgotPasswordRules = [
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
];

const resetPasswordRules = [
  body("password")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage("Password must contain uppercase, lowercase, and a number"),
  body("token")
    .matches(/^\d{6}$/).withMessage("Enter the 6-digit code from your SMS"),
];

const switchRoleRules = [
  body("role").isIn(VALID_ROLES).withMessage("Invalid role"),
];

// ── user management ───────────────────────────────────────────────────────────

const createUserRules = [
  body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
  body("password")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage("Password must contain uppercase, lowercase, and a number"),
  body("name").isLength({ min: 1 }).trim().withMessage("Name is required"),
  body("activeRole").optional().isIn(VALID_ROLES).withMessage("Invalid activeRole"),
  body("roles").optional().isArray().withMessage("roles must be an array"),
  body("roles.*").optional().isIn(VALID_ROLES).withMessage("Invalid role in roles array"),
  body("isEmployee").optional().isBoolean().withMessage("isEmployee must be a boolean"),
  body("phone").optional().isMobilePhone("any").withMessage("Invalid phone number"),
];

const assignRolesRules = [
  body("roles").isArray({ min: 1 }).withMessage("roles must be a non-empty array"),
  body("roles.*").isIn(VALID_ROLES).withMessage("Invalid role"),
];

const updateUserStatusRules = [
  body("status").isIn(["Active", "Inactive", "Suspended"]).withMessage("Invalid status"),
];

// ── HR setup ──────────────────────────────────────────────────────────────────

const createDepartmentRules = [
  body("name").isLength({ min: 1 }).trim().withMessage("Department name is required"),
  body("description").optional().isString(),
  body("parentId").optional().isString(),
];

const createJobTitleRules = [
  body("title").isLength({ min: 1 }).trim().withMessage("Job title is required"),
  body("description").optional().isString(),
  body("departmentId").optional().isString(),
  body("grade").optional().isString(),
];

const createShiftPatternRules = [
  body("name").isLength({ min: 1 }).trim().withMessage("Shift name is required"),
  body("startTime").matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage("startTime must be HH:mm"),
  body("endTime").matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage("endTime must be HH:mm"),
  body("isDefault").optional().isBoolean(),
];

const createLeaveTypeRules = [
  body("name").isLength({ min: 1 }).trim().withMessage("Leave type name is required"),
  body("daysAllowed").optional().isInt({ min: 1 }).withMessage("daysAllowed must be a positive integer"),
  body("isPaid").optional().isBoolean().withMessage("isPaid must be a boolean"),
];

const submitLeaveRequestRules = [
  body("leaveTypeId").isLength({ min: 1 }).withMessage("leaveTypeId is required"),
  body("startDate").isISO8601().withMessage("startDate must be a valid date (YYYY-MM-DD)"),
  body("endDate").isISO8601().withMessage("endDate must be a valid date (YYYY-MM-DD)"),
  body("reason").optional().isString(),
];

const approveLeaveRules = [
  body("action").isIn(["approve", "reject"]).withMessage("action must be 'approve' or 'reject'"),
  body("note").optional().isString(),
];

const onboardEmployeeRules = [
  body("startDate").isISO8601().withMessage("startDate must be a valid date (YYYY-MM-DD)"),
  body("employmentType").optional().isIn(["FullTime", "PartTime", "Contract", "Intern"])
    .withMessage("employmentType must be one of: FullTime, PartTime, Contract, Intern"),
  body("contractType").optional().isIn(["Permanent", "Fixed-Term", "Casual"])
    .withMessage("contractType must be one of: Permanent, Fixed-Term, Casual"),
  body("gender").optional().isIn(["Male", "Female", "Other"])
    .withMessage("gender must be one of: Male, Female, Other"),
  body("email").optional().isEmail().normalizeEmail().withMessage("email must be a valid email address"),
  body("basicSalary").optional().isFloat({ min: 0 }).withMessage("basicSalary must be a positive number"),
];

// ── shared ────────────────────────────────────────────────────────────────────

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const fieldErrors = errors.array().map(e => ({ field: e.path, message: e.msg }));
    const summary = fieldErrors.map(e => `${e.field}: ${e.message}`).join("; ");
    return res.status(422).json({
      success: false,
      message: summary,
      errors: fieldErrors,
    });
  }
  next();
}

module.exports = {
  loginRules,
  changePasswordRules,
  forgotPasswordRules,
  resetPasswordRules,
  switchRoleRules,
  createUserRules,
  assignRolesRules,
  updateUserStatusRules,
  createDepartmentRules,
  createJobTitleRules,
  createShiftPatternRules,
  createLeaveTypeRules,
  submitLeaveRequestRules,
  approveLeaveRules,
  onboardEmployeeRules,
  validate,
};
