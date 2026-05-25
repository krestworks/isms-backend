"use strict";
const prisma = require("../config/prisma");

const ok  = (res, data, status = 200) => res.status(status).json({ success: true,  data });
const err = (res, msg, status = 500) => res.status(status).json({ success: false, error: msg });

async function resolveStation(req) {
  const sid = req.headers["x-station-id"];
  if (sid) return sid;
  const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { homeLocation: true } });
  if (user?.homeLocation) {
    const st = await prisma.station.findFirst({ where: { name: user.homeLocation } });
    if (st) return st.id;
  }
  const st = await prisma.station.findFirst({ orderBy: { name: "asc" } });
  if (!st) throw new Error("No station found");
  return st.id;
}

// ── Report Templates ──────────────────────────────────────────────────────────

async function listTemplates(req, res) {
  try {
    const stationId = await resolveStation(req);
    const data = await prisma.reportTemplate.findMany({ where: { stationId }, orderBy: { createdAt: "desc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function createTemplate(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { name, module = "All", frequency = "daily", sections = "", status = "active" } = req.body;
    if (!name) return err(res, "name is required", 400);
    const r = await prisma.reportTemplate.create({ data: { stationId, name, module, frequency, sections, status } });
    ok(res, r, 201);
  } catch (e) { err(res, e.message); }
}

async function updateTemplate(req, res) {
  try {
    const fields = ["name", "module", "frequency", "sections", "status", "lastUsed"];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = req.body[f];
    const r = await prisma.reportTemplate.update({ where: { id: req.params.id }, data });
    ok(res, r);
  } catch (e) { err(res, e.message); }
}

async function deleteTemplate(req, res) {
  try {
    await prisma.reportTemplate.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Generated Reports ─────────────────────────────────────────────────────────

async function listReports(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { type, module, status } = req.query;
    const where = { stationId };
    if (type)   where.type   = type;
    if (module) where.module = module;
    if (status) where.status = status;
    const data = await prisma.generatedReport.findMany({ where, orderBy: { createdAt: "desc" } });
    // Shape createdAt into generatedAt string for frontend compatibility
    const shaped = data.map(r => ({
      ...r,
      generatedAt: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
      generatedBy: r.generatedBy,
      fileSize: r.fileSize || "—",
    }));
    ok(res, shaped);
  } catch (e) { err(res, e.message); }
}

async function createReport(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { title, type = "daily", module = "All", period, format = "PDF", status = "completed" } = req.body;
    if (!title || !period) return err(res, "title and period are required", 400);
    const generatedBy = req.user?.name || "System";
    const r = await prisma.generatedReport.create({
      data: { stationId, title, type, module, period, format, generatedBy, fileSize: "— KB", status },
    });
    ok(res, { ...r, generatedAt: r.createdAt.toISOString().slice(0, 16).replace("T", " ") }, 201);
  } catch (e) { err(res, e.message); }
}

async function updateReport(req, res) {
  try {
    const fields = ["title", "type", "module", "period", "format", "status", "fileSize"];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = req.body[f];
    const r = await prisma.generatedReport.update({ where: { id: req.params.id }, data });
    ok(res, { ...r, generatedAt: r.createdAt.toISOString().slice(0, 16).replace("T", " ") });
  } catch (e) { err(res, e.message); }
}

async function deleteReport(req, res) {
  try {
    await prisma.generatedReport.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Scheduled Reports ─────────────────────────────────────────────────────────

async function listScheduled(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { status } = req.query;
    const where = { stationId };
    if (status) where.status = status;
    const data = await prisma.scheduledReport.findMany({ where, orderBy: { createdAt: "desc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function createScheduled(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { name, type, frequency, modules = "All", recipients, status = "active" } = req.body;
    if (!name || !type || !frequency || !recipients) return err(res, "name, type, frequency, recipients are required", 400);
    const r = await prisma.scheduledReport.create({
      data: { stationId, name, type, frequency, modules, recipients, status },
    });
    ok(res, r, 201);
  } catch (e) { err(res, e.message); }
}

async function updateScheduled(req, res) {
  try {
    const fields = ["name", "type", "frequency", "modules", "recipients", "lastRun", "nextRun", "status"];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = req.body[f];
    const r = await prisma.scheduledReport.update({ where: { id: req.params.id }, data });
    ok(res, r);
  } catch (e) { err(res, e.message); }
}

async function deleteScheduled(req, res) {
  try {
    await prisma.scheduledReport.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

module.exports = {
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  listReports, createReport, updateReport, deleteReport,
  listScheduled, createScheduled, updateScheduled, deleteScheduled,
};
