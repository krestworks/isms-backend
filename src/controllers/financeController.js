"use strict";
const prisma = require("../config/prisma");
const { hasPermission } = require("../services/permissionService");

const ok  = (res, data, status = 200) => res.status(status).json({ success: true,  data });
const err = (res, msg, status = 500) => res.status(status).json({ success: false, error: msg });

async function resolveStation(req) {
  const isAdmin = await hasPermission(req.user.sub, "global", "stations.view");
  if (isAdmin) {
    const h = req.headers["x-station-id"];
    return h && h !== "global" ? h : null;
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { homeLocation: true } });
  return user?.homeLocation ?? null;
}

const revRef = () => "REV-" + Date.now().toString(36).toUpperCase();
const expRef = () => "EXP-" + Date.now().toString(36).toUpperCase();

// ── Revenue ───────────────────────────────────────────────────────────────────

async function listRevenue(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { from, to, module, status } = req.query;
    const where = { stationId };
    if (status) where.status = status;
    if (module) where.module = module;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to)   where.date.lte = to;
    }
    const data = await prisma.financeRevenue.findMany({ where, orderBy: { date: "desc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function createRevenue(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { date, module, category, description, amount, paymentMethod, reference, status = "completed" } = req.body;
    if (!description || !amount) return err(res, "description and amount are required", 400);
    const r = await prisma.financeRevenue.create({
      data: { stationId, date: date || new Date().toISOString().split("T")[0], module: module || "General", category: category || "Product Sales", description, amount: +amount, paymentMethod: paymentMethod || "Cash", reference: reference || revRef(), status },
    });
    ok(res, r, 201);
  } catch (e) { err(res, e.message); }
}

async function updateRevenue(req, res) {
  try {
    const fields = ["date", "module", "category", "description", "amount", "paymentMethod", "reference", "status"];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = f === "amount" ? +req.body[f] : req.body[f];
    const r = await prisma.financeRevenue.update({ where: { id: req.params.id }, data });
    ok(res, r);
  } catch (e) { err(res, e.message); }
}

async function deleteRevenue(req, res) {
  try {
    await prisma.financeRevenue.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Expenses ──────────────────────────────────────────────────────────────────

async function listExpenses(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { from, to, module, status, category } = req.query;
    const where = { stationId };
    if (status)   where.status   = status;
    if (module)   where.module   = module;
    if (category) where.category = category;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to)   where.date.lte = to;
    }
    const data = await prisma.financeExpense.findMany({ where, orderBy: { date: "desc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function createExpense(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { date, module, category, vendor, description, amount, paymentMethod, approvedBy, status = "pending" } = req.body;
    if (!description || !amount) return err(res, "description and amount are required", 400);
    const e2 = await prisma.financeExpense.create({
      data: { stationId, date: date || new Date().toISOString().split("T")[0], module: module || "General", category: category || "Miscellaneous", vendor, description, amount: +amount, paymentMethod: paymentMethod || "Cash", approvedBy, status },
    });
    ok(res, e2, 201);
  } catch (e) { err(res, e.message); }
}

async function updateExpense(req, res) {
  try {
    const fields = ["date", "module", "category", "vendor", "description", "amount", "paymentMethod", "approvedBy", "status"];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = f === "amount" ? +req.body[f] : req.body[f];
    const e2 = await prisma.financeExpense.update({ where: { id: req.params.id }, data });
    ok(res, e2);
  } catch (e) { err(res, e.message); }
}

async function deleteExpense(req, res) {
  try {
    await prisma.financeExpense.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── P&L Summary ───────────────────────────────────────────────────────────────
// Aggregates FinanceRevenue and FinanceExpense by module for a date range.

async function getProfitLoss(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { from, to } = req.query;
    const dateFilter = {};
    if (from) dateFilter.gte = from;
    if (to)   dateFilter.lte = to;

    const [revenues, expenses] = await Promise.all([
      prisma.financeRevenue.findMany({ where: { stationId, ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}), status: "completed" } }),
      prisma.financeExpense.findMany({ where: { stationId, ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}), status: "paid" } }),
    ]);

    const modules = [...new Set([...revenues.map(r => r.module), ...expenses.map(e => e.module)])];

    const byModule = modules.map(mod => {
      const revenue = revenues.filter(r => r.module === mod).reduce((s, r) => s + r.amount, 0);
      const cogs    = expenses.filter(e => e.module === mod).reduce((s, e) => s + e.amount, 0);
      return { module: mod, revenue, cogs, opex: 0 };
    });

    const totalRevenue  = byModule.reduce((s, r) => s + r.revenue, 0);
    const totalCogs     = byModule.reduce((s, r) => s + r.cogs, 0);
    const generalOpex   = expenses.filter(e => e.module === "General").reduce((s, e) => s + e.amount, 0);
    const grossProfit   = totalRevenue - totalCogs;
    const netProfit     = grossProfit - generalOpex;

    ok(res, { byModule, totalRevenue, totalCogs, generalOpex, grossProfit, netProfit });
  } catch (e) { err(res, e.message); }
}

// ── Budget ────────────────────────────────────────────────────────────────────

async function listBudgets(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { year, month } = req.query;
    const where = { stationId };
    if (year)  where.year  = +year;
    if (month) where.month = +month;
    const data = await prisma.financeBudget.findMany({ where, orderBy: [{ year: "desc" }, { month: "desc" }] });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function upsertBudget(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { year, month, module, metric, amount } = req.body;
    if (!year || !month || !module || !metric) return err(res, "year, month, module, metric are required", 400);
    const r = await prisma.financeBudget.upsert({
      where:  { stationId_year_month_module_metric: { stationId, year: +year, month: +month, module, metric } },
      create: { stationId, year: +year, month: +month, module, metric, amount: +amount || 0 },
      update: { amount: +amount || 0 },
    });
    ok(res, r);
  } catch (e) { err(res, e.message); }
}

async function deleteBudget(req, res) {
  try {
    await prisma.financeBudget.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// Variance: compare budgeted vs actual revenue/expenses for a month
async function getVariance(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { year, month } = req.query;
    if (!year || !month) return err(res, "year and month are required", 400);

    const y = +year; const m = +month;
    const pad = String(m).padStart(2, "0");
    const from = `${y}-${pad}-01`;
    const to   = `${y}-${pad}-31`;

    const [budgets, revenues, expenses] = await Promise.all([
      prisma.financeBudget.findMany({ where: { stationId, year: y, month: m } }),
      prisma.financeRevenue.findMany({ where: { stationId, date: { gte: from, lte: to }, status: "completed" } }),
      prisma.financeExpense.findMany({ where: { stationId, date: { gte: from, lte: to }, status: "paid" } }),
    ]);

    const modules = [...new Set([...budgets.map(b => b.module), ...revenues.map(r => r.module), ...expenses.map(e => e.module)])];

    const rows = [];
    for (const mod of modules) {
      const revBudget = budgets.find(b => b.module === mod && b.metric === "Revenue")?.amount ?? 0;
      const expBudget = budgets.find(b => b.module === mod && b.metric === "Expenses")?.amount ?? 0;
      const revActual = revenues.filter(r => r.module === mod).reduce((s, r) => s + r.amount, 0);
      const expActual = expenses.filter(e => e.module === mod).reduce((s, e) => s + e.amount, 0);
      if (revBudget || revActual) rows.push({ module: mod, metric: "Revenue",  budget: revBudget, actual: revActual });
      if (expBudget || expActual) rows.push({ module: mod, metric: "Expenses", budget: expBudget, actual: expActual });
    }

    ok(res, { rows, year: y, month: m });
  } catch (e) { err(res, e.message); }
}

module.exports = { listRevenue, createRevenue, updateRevenue, deleteRevenue, listExpenses, createExpense, updateExpense, deleteExpense, getProfitLoss, listBudgets, upsertBudget, deleteBudget, getVariance };
