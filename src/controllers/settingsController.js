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

// ── Station Config (key-value JSON blobs per section) ─────────────────────────

async function getConfig(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { section } = req.params;
    const row = await prisma.stationConfig.findUnique({ where: { stationId_section: { stationId, section } } });
    ok(res, row ? JSON.parse(row.data) : {});
  } catch (e) { err(res, e.message); }
}

async function setConfig(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { section } = req.params;
    const row = await prisma.stationConfig.upsert({
      where:  { stationId_section: { stationId, section } },
      create: { stationId, section, data: JSON.stringify(req.body) },
      update: { data: JSON.stringify(req.body) },
    });
    ok(res, JSON.parse(row.data));
  } catch (e) { err(res, e.message); }
}

// ── VAT Rates ─────────────────────────────────────────────────────────────────

async function listVatRates(req, res) {
  try {
    const stationId = await resolveStation(req);
    const data = await prisma.vatRate.findMany({ where: { stationId }, orderBy: { createdAt: "asc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function createVatRate(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { name, rate, appliesTo, status = "active" } = req.body;
    if (!name) return err(res, "name is required", 400);
    const r = await prisma.vatRate.create({ data: { stationId, name, rate: +rate || 0, appliesTo: appliesTo || "", status } });
    ok(res, r, 201);
  } catch (e) { err(res, e.message); }
}

async function updateVatRate(req, res) {
  try {
    const fields = ["name", "rate", "appliesTo", "status"];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = f === "rate" ? +req.body[f] : req.body[f];
    const r = await prisma.vatRate.update({ where: { id: req.params.id }, data });
    ok(res, r);
  } catch (e) { err(res, e.message); }
}

async function deleteVatRate(req, res) {
  try {
    await prisma.vatRate.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

module.exports = { getConfig, setConfig, listVatRates, createVatRate, updateVatRate, deleteVatRate };
