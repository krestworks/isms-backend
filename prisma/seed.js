"use strict";
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "12", 10);

// ── permissions ───────────────────────────────────────────────────────────────
// Codes are aligned with the spec's permission registry (§2.5).
// Original codes kept where they differ from spec to preserve frontend compatibility.

const ALL_PERMISSIONS = [
  // ── settings & user management ───────────────────────────────────────────
  { code: "settings.view",                  category: "settings",      description: "View system settings" },
  { code: "settings.edit",                  category: "settings",      description: "Edit system settings" },
  { code: "settings.station.configure",     category: "settings",      description: "Configure station settings" },
  { code: "settings.users.manage",          category: "settings",      description: "Create and manage user accounts" },
  { code: "settings.permissions.manage",    category: "settings",      description: "Assign/revoke user-level permissions" },

  // ── auth / user account management (legacy codes kept for compatibility) ──
  { code: "auth.users.view",                category: "auth",          description: "View users" },
  { code: "auth.users.create",              category: "auth",          description: "Create users" },
  { code: "auth.users.edit",                category: "auth",          description: "Edit users" },
  { code: "auth.users.delete",              category: "auth",          description: "Delete users" },
  { code: "auth.roles.view",                category: "auth",          description: "View roles" },
  { code: "auth.roles.manage",              category: "auth",          description: "Manage roles" },
  { code: "auth.permissions.manage",        category: "auth",          description: "Manage permissions (legacy)" },

  // ── stations — Admin only ─────────────────────────────────────────────────
  { code: "stations.view",                  category: "stations",      description: "View all stations/locations" },
  { code: "stations.create",                category: "stations",      description: "Create stations" },
  { code: "stations.manage",                category: "stations",      description: "Manage stations" },
  { code: "stations.modules.configure",     category: "stations",      description: "Enable/disable modules per station" },

  // ── fuel ──────────────────────────────────────────────────────────────────
  { code: "fuel.tanks.view",                category: "fuel",          description: "View fuel tanks" },
  { code: "fuel.tanks.create",              category: "fuel",          description: "Register a new storage tank" },
  { code: "fuel.tanks.edit",                category: "fuel",          description: "Edit tank configuration" },
  { code: "fuel.tanks.manage",              category: "fuel",          description: "Manage fuel tanks (legacy)" },
  { code: "fuel.pumps.view",                category: "fuel",          description: "View fuel pumps" },
  { code: "fuel.pumps.create",              category: "fuel",          description: "Register a new pump" },
  { code: "fuel.pumps.edit",                category: "fuel",          description: "Edit pump configuration" },
  { code: "fuel.pumps.manage",              category: "fuel",          description: "Manage fuel pumps (legacy)" },
  { code: "fuel.dips.record",               category: "fuel",          description: "Record tank dip reading" },
  { code: "fuel.sales.view",                category: "fuel",          description: "View fuel sales" },
  { code: "fuel.sales.record",              category: "fuel",          description: "Record fuel sales" },
  { code: "fuel.sales.void",                category: "fuel",          description: "Void fuel sales" },
  { code: "fuel.inventory.receive",         category: "fuel",          description: "Record fuel delivery" },
  { code: "fuel.inventory.adjust",          category: "fuel",          description: "Adjust fuel stock levels" },
  { code: "fuel.deliveries.view",           category: "fuel",          description: "View fuel deliveries (legacy)" },
  { code: "fuel.deliveries.create",         category: "fuel",          description: "Create fuel deliveries (legacy)" },
  { code: "fuel.shifts.open",               category: "fuel",          description: "Open a new fuel shift" },
  { code: "fuel.shifts.close",              category: "fuel",          description: "Close and reconcile a fuel shift" },
  { code: "fuel.reports.view",              category: "fuel",          description: "View fuel reports and analytics" },
  { code: "fuel.reconciliation.view",       category: "fuel",          description: "View fuel reconciliation" },
  { code: "fuel.reconciliation.approve",    category: "fuel",          description: "Approve fuel reconciliation" },

  // ── LPG ───────────────────────────────────────────────────────────────────
  { code: "lpg.cylinders.view",             category: "lpg",           description: "View cylinder inventory" },
  { code: "lpg.cylinders.manage",           category: "lpg",           description: "Register/edit cylinders" },
  { code: "lpg.inventory.view",             category: "lpg",           description: "View LPG inventory (legacy)" },
  { code: "lpg.inventory.manage",           category: "lpg",           description: "Manage LPG inventory (legacy)" },
  { code: "lpg.sales.view",                 category: "lpg",           description: "View LPG sales" },
  { code: "lpg.sales.record",               category: "lpg",           description: "Record LPG sales" },
  { code: "lpg.sales.void",                 category: "lpg",           description: "Void an LPG sale" },
  { code: "lpg.refills.record",             category: "lpg",           description: "Log refill from supplier" },
  { code: "lpg.suppliers.manage",           category: "lpg",           description: "Create and edit LPG suppliers" },
  { code: "lpg.orders.create",              category: "lpg",           description: "Create client LPG orders" },
  { code: "lpg.invoices.issue",             category: "lpg",           description: "Issue LPG invoices" },
  { code: "lpg.reports.view",               category: "lpg",           description: "View LPG reports" },
  { code: "lpg.shifts.open",                category: "lpg",           description: "Open LPG shift" },
  { code: "lpg.shifts.close",               category: "lpg",           description: "Close LPG shift" },
  { code: "lpg.deliveries.view",            category: "lpg",           description: "View LPG deliveries (legacy)" },
  { code: "lpg.deliveries.create",          category: "lpg",           description: "Create LPG deliveries (legacy)" },

  // ── water ─────────────────────────────────────────────────────────────────
  { code: "water.production.view",          category: "water",         description: "View water production" },
  { code: "water.production.log",           category: "water",         description: "Record a production batch" },
  { code: "water.production.approve",       category: "water",         description: "Approve or reject production batch" },
  { code: "water.equipment.view",           category: "water",         description: "View water equipment" },
  { code: "water.equipment.manage",         category: "water",         description: "Manage equipment registry and service logs" },
  { code: "water.sales.record",             category: "water",         description: "Record water sale" },
  { code: "water.orders.create",            category: "water",         description: "Create client water orders" },
  { code: "water.distributions.approve",    category: "water",         description: "Approve orders for dispatch" },
  { code: "water.distributions.deliver",    category: "water",         description: "Confirm delivery" },
  { code: "water.distribution.view",        category: "water",         description: "View water distribution (legacy)" },
  { code: "water.distribution.record",      category: "water",         description: "Record water distribution (legacy)" },
  { code: "water.invoices.issue",           category: "water",         description: "Issue water invoices" },
  { code: "water.reports.view",             category: "water",         description: "View water production reports" },
  { code: "water.shifts.open",              category: "water",         description: "Open water shift" },
  { code: "water.shifts.close",             category: "water",         description: "Close water shift" },

  // ── carwash ───────────────────────────────────────────────────────────────
  { code: "carwash.queue.view",             category: "carwash",       description: "View carwash queue" },
  { code: "carwash.queue.manage",           category: "carwash",       description: "Add, assign, and update vehicle queue" },
  { code: "carwash.packages.view",          category: "carwash",       description: "View carwash packages" },
  { code: "carwash.packages.manage",        category: "carwash",       description: "Create and edit wash packages and pricing" },
  { code: "carwash.bookings.create",        category: "carwash",       description: "Create advance bookings" },
  { code: "carwash.bookings.cancel",        category: "carwash",       description: "Cancel a booking" },
  { code: "carwash.sales.view",             category: "carwash",       description: "View carwash sales" },
  { code: "carwash.sales.record",           category: "carwash",       description: "Record carwash payment" },
  { code: "carwash.sales.void",             category: "carwash",       description: "Void a carwash sale" },
  { code: "carwash.reports.view",           category: "carwash",       description: "View carwash reports" },
  { code: "carwash.shifts.open",            category: "carwash",       description: "Open carwash shift" },
  { code: "carwash.shifts.close",           category: "carwash",       description: "Close carwash shift" },

  // ── auto services ─────────────────────────────────────────────────────────
  { code: "auto.jobs.view",                 category: "auto",          description: "View job cards" },
  { code: "auto.jobs.create",               category: "auto",          description: "Create new job card" },
  { code: "auto.jobs.assign",               category: "auto",          description: "Assign technician to job" },
  { code: "auto.jobs.update",               category: "auto",          description: "Update job card status and notes" },
  { code: "auto.services.view",             category: "auto",          description: "View auto services (legacy)" },
  { code: "auto.services.record",           category: "auto",          description: "Record auto services (legacy)" },
  { code: "auto.pricing.manage",            category: "auto",          description: "Set and edit service pricing" },
  { code: "auto.inventory.manage",          category: "auto",          description: "Manage parts inventory" },
  { code: "auto.invoices.issue",            category: "auto",          description: "Create auto service invoice" },
  { code: "auto.payments.collect",          category: "auto",          description: "Record payment for auto invoice" },
  { code: "auto.billing.view",              category: "auto",          description: "View auto billing (legacy)" },
  { code: "auto.billing.manage",            category: "auto",          description: "Manage auto billing (legacy)" },
  { code: "auto.reports.view",              category: "auto",          description: "View auto service reports" },
  { code: "auto.shifts.open",               category: "auto",          description: "Open auto services shift" },
  { code: "auto.shifts.close",              category: "auto",          description: "Close auto services shift" },

  // ── clients ───────────────────────────────────────────────────────────────
  { code: "clients.view",                   category: "clients",       description: "View client profiles" },
  { code: "clients.create",                 category: "clients",       description: "Create new client record" },
  { code: "clients.edit",                   category: "clients",       description: "Edit client profile" },
  { code: "clients.history.view",           category: "clients",       description: "View client purchase history" },
  { code: "clients.coupons.issue",          category: "clients",       description: "Issue coupons to clients" },
  { code: "clients.loyalty.manage",         category: "clients",       description: "Manage loyalty points" },
  { code: "clients.credit.manage",          category: "clients",       description: "Set credit limits and suspend accounts" },
  { code: "clients.statement.export",       category: "clients",       description: "Generate client account statement" },

  // ── POS ───────────────────────────────────────────────────────────────────
  { code: "pos.sale.process",               category: "pos",           description: "Process a POS sale transaction" },
  { code: "pos.discount.line",              category: "pos",           description: "Apply item-level discount" },
  { code: "pos.discount.order",             category: "pos",           description: "Apply order-level discount" },
  { code: "pos.void.transaction",           category: "pos",           description: "Void a POS transaction" },
  { code: "pos.return.process",             category: "pos",           description: "Process a product return" },
  { code: "pos.drawer.open",                category: "pos",           description: "Open cash drawer without a sale" },
  { code: "pos.session.open",               category: "pos",           description: "Open a cashier POS session" },
  { code: "pos.session.close",              category: "pos",           description: "Close a cashier POS session" },
  { code: "pos.inventory.manage",           category: "pos",           description: "Manage POS product catalog and stock" },
  { code: "pos.inventory.receive",          category: "pos",           description: "Receive stock from supplier" },
  { code: "pos.suppliers.manage",           category: "pos",           description: "Manage POS suppliers and purchase orders" },
  { code: "pos.stocktake.conduct",          category: "pos",           description: "Conduct a POS stocktake" },
  { code: "pos.reports.view",               category: "pos",           description: "View POS reports" },
  { code: "pos.etims.view",                 category: "pos",           description: "View eTIMS transmission log" },
  { code: "pos.sales.record",               category: "pos",           description: "Record POS sales (legacy)" },
  { code: "pos.sales.view",                 category: "pos",           description: "View POS sales (legacy)" },
  { code: "pos.void",                       category: "pos",           description: "Void POS transactions (legacy)" },

  // ── finance ───────────────────────────────────────────────────────────────
  { code: "finance.reports.view",           category: "finance",       description: "View all financial reports" },
  { code: "finance.reports.export",         category: "finance",       description: "Export financial reports" },
  { code: "finance.reconciliation.submit",  category: "finance",       description: "Submit shift cash reconciliation" },
  { code: "finance.reconciliation.approve", category: "finance",       description: "Approve submitted reconciliation" },
  { code: "finance.expenses.view",          category: "finance",       description: "View expenses" },
  { code: "finance.expenses.create",        category: "finance",       description: "Create expenses" },
  { code: "finance.expenses.approve",       category: "finance",       description: "Approve expenses" },
  { code: "finance.payroll.view",           category: "finance",       description: "View payroll" },
  { code: "finance.payroll.manage",         category: "finance",       description: "Manage payroll" },

  // ── HR ────────────────────────────────────────────────────────────────────
  { code: "hr.staff.view",                  category: "hr",            description: "View staff directory" },
  { code: "hr.staff.create",                category: "hr",            description: "Create employee record" },
  { code: "hr.staff.edit",                  category: "hr",            description: "Edit employee profile" },
  { code: "hr.staff.terminate",             category: "hr",            description: "Terminate staff" },
  { code: "hr.shifts.view",                 category: "hr",            description: "View shifts" },
  { code: "hr.shifts.manage",               category: "hr",            description: "Manage shifts" },
  { code: "hr.attendance.view",             category: "hr",            description: "View attendance records" },
  { code: "hr.attendance.record",           category: "hr",            description: "Record and edit attendance" },
  { code: "hr.leaves.view",                 category: "hr",            description: "View leave requests" },
  { code: "hr.leaves.approve",              category: "hr",            description: "Approve leave requests" },
  { code: "hr.leave.approve",               category: "hr",            description: "Approve or reject leave requests (spec)" },
  { code: "hr.payroll.export",              category: "hr",            description: "Generate payroll export" },
  { code: "hr.disciplinary.view",           category: "hr",            description: "View disciplinary records" },
  { code: "hr.disciplinary.record",         category: "hr",            description: "Log disciplinary actions" },
  { code: "hr.offboard",                    category: "hr",            description: "Execute offboarding process" },
  { code: "hr.setup.departments",           category: "hr",            description: "Create and manage departments" },
  { code: "hr.setup.jobtitles",             category: "hr",            description: "Create and manage job titles" },
  { code: "hr.setup.leavetypes",            category: "hr",            description: "Configure leave types and policies" },
  { code: "hr.setup.holidays",             category: "hr",            description: "Manage public holidays and non-working days" },
  { code: "hr.setup.shifts",               category: "hr",            description: "Configure shift patterns" },

  // ── business (sub-businesses: Mart, Pharmacy, Restaurant, Bakery) ────────
  { code: "business.setup.manage",      category: "business", description: "Enable sub-businesses and configure their settings" },
  { code: "business.products.view",     category: "business", description: "View products and categories" },
  { code: "business.products.manage",   category: "business", description: "Add, edit and delete products and categories" },
  { code: "business.stock.view",        category: "business", description: "View stock movement history" },
  { code: "business.stock.adjust",      category: "business", description: "Manually adjust product stock levels" },
  { code: "business.suppliers.view",    category: "business", description: "View supplier list" },
  { code: "business.suppliers.manage",  category: "business", description: "Add, edit and delete suppliers" },
  { code: "business.orders.view",       category: "business", description: "View purchase orders" },
  { code: "business.orders.create",     category: "business", description: "Create and manage purchase orders" },
  { code: "business.orders.receive",    category: "business", description: "Receive purchase orders and update stock" },
  { code: "business.sales.view",        category: "business", description: "View business sales history" },
  { code: "business.pos.record",        category: "business", description: "Process POS sales in sub-businesses" },
  { code: "business.pos.void",          category: "business", description: "Void a completed business sale" },
  { code: "business.expenses.view",     category: "business", description: "View business expenses" },
  { code: "business.expenses.record",   category: "business", description: "Record and manage business expenses" },
  { code: "business.restaurant.manage", category: "business", description: "Manage restaurant tables and kitchen orders" },
  { code: "business.reports.view",      category: "business", description: "View business reports and analytics" },

  // ── compliance ────────────────────────────────────────────────────────────
  { code: "compliance.view",                category: "compliance",    description: "View compliance records" },
  { code: "compliance.manage",              category: "compliance",    description: "Manage compliance records (legacy)" },
  { code: "compliance.inspections.conduct", category: "compliance",    description: "Conduct compliance inspections" },
  { code: "compliance.cars.manage",         category: "compliance",    description: "Manage corrective action reports" },
  { code: "compliance.permits.manage",      category: "compliance",    description: "Manage permits and licences" },

  // ── notifications ─────────────────────────────────────────────────────────
  { code: "notifications.view",             category: "notifications", description: "View notifications" },
  { code: "notifications.manage",           category: "notifications", description: "Manage notifications" },
  { code: "notifications.sms.send",         category: "notifications", description: "Trigger manual SMS via Africa's Talking" },
];

const ALL_CODES = ALL_PERMISSIONS.map(p => p.code);

// Codes never given to Manager or LocationHead
// Admin = org-level control. Manager = full operational access within their station.
const MANAGER_DENIED = new Set([
  // Only Admin can see all stations / create / delete stations (org structure)
  "stations.view",    // Managers see only their own station
  "stations.create",
  "stations.manage",  // Soft-delete, restore, purge stations
  // Only Admin can delete users or manage system-wide roles/permissions
  "auth.users.delete", "auth.roles.manage", "auth.permissions.manage",
  // Only Admin can manage system users and change global settings
  "settings.users.manage", "settings.edit",
]);

// Codes for the Accountant role
const ACCOUNTANT_CODES = [
  "auth.users.view", "auth.roles.view",
  "settings.view",
  "finance.reports.view", "finance.reports.export",
  "finance.reconciliation.submit", "finance.reconciliation.approve",
  "finance.expenses.view", "finance.expenses.create", "finance.expenses.approve",
  "finance.payroll.view",
  "clients.view", "clients.create", "clients.edit",
  "clients.history.view", "clients.statement.export",
  "pos.sales.view", "pos.reports.view",
  "hr.staff.view", "hr.shifts.view", "hr.attendance.view", "hr.leaves.view",
  "fuel.sales.view", "fuel.reports.view",
  "fuel.reconciliation.view", "fuel.reconciliation.approve",
  "lpg.sales.view", "lpg.reports.view",
  "water.production.view", "water.reports.view",
  "carwash.sales.view", "carwash.reports.view",
  "auto.billing.view", "auto.reports.view",
  "business.products.view", "business.stock.view",
  "business.suppliers.view", "business.orders.view",
  "business.sales.view", "business.expenses.view", "business.expenses.record",
  "business.reports.view",
  "notifications.view",
];

// Codes for the Attendant role (fuel-specific + basic)
const ATTENDANT_CODES = [
  "fuel.tanks.view",
  "fuel.pumps.view",
  "fuel.sales.view",
  "fuel.sales.record",
  "business.products.view",
  "business.pos.record",
  "business.sales.view",
  "notifications.view",
];

// Codes for the base Employee role (portal access only)
const EMPLOYEE_CODES = [
  "hr.shifts.view",
  "hr.attendance.view",
  "hr.leaves.view",
  "notifications.view",
];

const ROLES = [
  {
    name: "Admin",
    description: "Full system administrator — access to all modules and station management",
    permissions: ALL_CODES,
  },
  {
    name: "Manager",
    description: "Station manager — manages daily operations, staff, and reporting",
    permissions: ALL_CODES.filter(c => !MANAGER_DENIED.has(c)),
  },
  {
    name: "LocationHead",
    description: "Branch location head — same operational scope as Manager but limited to their station",
    permissions: ALL_CODES.filter(c => !MANAGER_DENIED.has(c)),
  },
  {
    name: "Accountant",
    description: "Handles financial reporting, expenses, and payroll",
    permissions: ACCOUNTANT_CODES,
  },
  {
    name: "Attendant",
    description: "Fuel station attendant — records and views fuel sales only",
    permissions: ATTENDANT_CODES,
  },
  {
    name: "Employee",
    description: "General employee — employee portal access only",
    permissions: EMPLOYEE_CODES,
  },
];

// ── seed users ────────────────────────────────────────────────────────────────

const SEED_USERS = [
  {
    email: "admin@isms.co.ke",
    password: "Admin@1234",
    name: "Admin User",
    phone: "+254700000001",
    employeeId: "EMP-001",
    activeRole: "Admin",
    status: "Active",
    isEmployee: false,
    roles: ["Admin", "Manager", "Accountant", "Employee"],
  },
  {
    email: "manager@isms.co.ke",
    password: "Manager@1234",
    name: "Station Manager",
    phone: "+254700000002",
    employeeId: "EMP-002",
    activeRole: "Manager",
    status: "Active",
    isEmployee: false,
    roles: ["Manager", "Employee"],
  },
  {
    email: "attendant@isms.co.ke",
    password: "Attend@1234",
    name: "Fuel Attendant",
    phone: "+254700000003",
    employeeId: "EMP-003",
    activeRole: "Attendant",
    status: "Active",
    isEmployee: true,
    roles: ["Attendant", "Employee"],
  },
];

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding database...\n");

  // 1. Station (name no longer @unique — use findFirst)
  let station = await prisma.station.findFirst({
    where: { name: "Main Branch", deletedAt: null },
  });
  if (!station) {
    station = await prisma.station.create({
      data: { name: "Main Branch", type: "Branch", status: "Active" },
    });
  }
  console.log(`Station: ${station.name}`);

  // 2. Permissions (upsert by code)
  console.log(`\nUpserting ${ALL_PERMISSIONS.length} permissions...`);
  for (const p of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { description: p.description, category: p.category },
      create: p,
    });
  }

  // 3. Roles + RolePermissions
  console.log(`\nSeeding ${ROLES.length} roles...`);
  for (const roleDef of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleDef.name },
      update: { description: roleDef.description },
      create: { name: roleDef.name, description: roleDef.description },
    });

    // Rebuild role permissions from scratch
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    for (const code of roleDef.permissions) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (!perm) { console.warn(`  WARN: permission code "${code}" not found`); continue; }
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: perm.id },
      });
    }
    console.log(`  ${role.name}: ${roleDef.permissions.length} permissions`);
  }

  // 4. Users + UserRoles
  console.log("\nSeeding users...");
  for (const u of SEED_USERS) {
    let user = await prisma.user.findUnique({ where: { email: u.email } });

    if (!user) {
      const hashed = await bcrypt.hash(u.password, BCRYPT_ROUNDS);
      user = await prisma.user.create({
        data: {
          email: u.email,
          password: hashed,
          name: u.name,
          employeeId: u.employeeId,
          activeRole: u.activeRole,
          status: u.status,
          isEmployee: u.isEmployee,
        },
      });
      console.log(`  Created: ${u.email}`);
    } else {
      console.log(`  Exists:  ${u.email} (updating activeRole + isEmployee)`);
      user = await prisma.user.update({
        where: { id: user.id },
        data: { activeRole: u.activeRole, isEmployee: u.isEmployee },
      });
    }

    // Assign roles globally (stationId = "global")
    for (const roleName of u.roles) {
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) { console.warn(`  WARN: role "${roleName}" not found`); continue; }
      await prisma.userRole.upsert({
        where: { userId_roleId_stationId: { userId: user.id, roleId: role.id, stationId: "global" } },
        update: {},
        create: { userId: user.id, roleId: role.id, stationId: "global" },
      });
    }
    console.log(`    Roles: ${u.roles.join(", ")}`);
  }

  // 5a. Employee records for isEmployee seed users
  //     Creates minimal HR records so the Employee Portal works out of the box.
  console.log("\nSeeding employee records for isEmployee users...");
  const employeeUsers = SEED_USERS.filter(u => u.isEmployee);
  for (const u of employeeUsers) {
    const dbUser = await prisma.user.findUnique({ where: { email: u.email } });
    if (!dbUser) continue;

    const existing = await prisma.employee.findUnique({ where: { userId: dbUser.id } });
    if (existing) {
      console.log(`  Employee record exists for ${u.email}`);
      continue;
    }

    // Ensure a "General" department exists for this station
    let dept = await prisma.department.findFirst({ where: { stationId: station.id, name: "General" } });
    if (!dept) {
      dept = await prisma.department.create({
        data: { name: "General", stationId: station.id, description: "Default department" },
      });
    }

    // Ensure an "Attendant" job title exists for this station
    let jt = await prisma.jobTitle.findFirst({ where: { stationId: station.id, title: "Attendant" } });
    if (!jt) {
      jt = await prisma.jobTitle.create({
        data: { title: "Attendant", departmentId: dept.id, stationId: station.id, grade: "G1" },
      });
    }

    await prisma.employee.create({
      data: {
        userId:         dbUser.id,
        employeeNumber: u.employeeId,
        stationId:      station.id,
        departmentId:   dept.id,
        jobTitleId:     jt.id,
        employmentType: "Full-Time",
        contractType:   "Permanent",
        startDate:      new Date("2025-01-15"),
        status:         "Active",
        gender:         "Male",
      },
    });
    console.log(`  Created employee record for ${u.email} (${u.employeeId})`);

    // Also set homeLocation on the User so location scope works
    await prisma.user.update({
      where:  { id: dbUser.id },
      data:   { homeLocation: station.id },
    });
  }

  // 5b. Seed default StationModules for existing stations (HR always enabled)
  const ALL_MODULES = ["hr", "fuel", "lpg", "water", "carwash", "auto", "pos", "finance", "compliance"];
  const stations = await prisma.station.findMany();
  for (const s of stations) {
    for (const mod of ALL_MODULES) {
      await prisma.stationModule.upsert({
        where: { stationId_module: { stationId: s.id, module: mod } },
        update: {},
        create: { stationId: s.id, module: mod, isEnabled: mod === "hr" },
      });
    }
  }
  console.log(`\nStation modules seeded (HR enabled by default for ${stations.length} station(s))`);

  console.log("\nSeed complete. Default credentials:");
  console.log("  Admin:     admin@isms.co.ke     / Admin@1234    (activeRole: Admin)");
  console.log("  Manager:   manager@isms.co.ke   / Manager@1234  (activeRole: Manager)");
  console.log("  Attendant: attendant@isms.co.ke / Attend@1234   (activeRole: Attendant)");
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
