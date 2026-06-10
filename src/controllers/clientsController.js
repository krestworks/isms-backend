"use strict";
const prisma = require("../config/prisma");
const { hasPermission } = require("../services/permissionService");

const ok  = (res, data, status = 200, meta) => res.status(status).json(meta ? { success: true, data, meta } : { success: true, data });
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

// ── Clients ───────────────────────────────────────────────────────────────────

async function listClients(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { status, type } = req.query;
    const where = { stationId };
    if (status) where.status = status;
    if (type)   where.type   = type;
    const data = await prisma.client.findMany({ where, orderBy: { name: "asc" } });
    // Parse modules string back to array for the frontend
    ok(res, data.map(c => ({ ...c, modules: c.modules ? c.modules.split(",").filter(Boolean) : [] })));
  } catch (e) { err(res, e.message); }
}

async function createClient(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { name, phone, email, type, modules = [], notes, status = "active" } = req.body;
    if (!name) return err(res, "name is required", 400);
    const c = await prisma.client.create({
      data: { stationId, name, phone, email, type: type || "Individual", modules: Array.isArray(modules) ? modules.join(",") : modules, notes, status },
    });
    ok(res, { ...c, modules: c.modules ? c.modules.split(",").filter(Boolean) : [] }, 201);
  } catch (e) { err(res, e.message); }
}

async function updateClient(req, res) {
  try {
    const { name, phone, email, type, modules, notes, status, totalSpent, visits } = req.body;
    const data = {};
    if (name        !== undefined) data.name        = name;
    if (phone       !== undefined) data.phone       = phone;
    if (email       !== undefined) data.email       = email;
    if (type        !== undefined) data.type        = type;
    if (modules     !== undefined) data.modules     = Array.isArray(modules) ? modules.join(",") : modules;
    if (notes       !== undefined) data.notes       = notes;
    if (status      !== undefined) data.status      = status;
    if (totalSpent  !== undefined) data.totalSpent  = totalSpent;
    if (visits      !== undefined) data.visits      = visits;
    const c = await prisma.client.update({ where: { id: req.params.id }, data });
    ok(res, { ...c, modules: c.modules ? c.modules.split(",").filter(Boolean) : [] });
  } catch (e) { err(res, e.message); }
}

async function deleteClient(req, res) {
  try {
    await prisma.client.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Coupons ───────────────────────────────────────────────────────────────────

async function listCoupons(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { status, module } = req.query;
    const where = { stationId };
    if (status) where.status = status;
    if (module) where.module = module;
    const data = await prisma.coupon.findMany({ where, orderBy: { createdAt: "desc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function createCoupon(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { code, module, discountType, discountValue, minSpend, maxUses, validFrom, validTo, status = "active" } = req.body;
    if (!code || !validFrom || !validTo) return err(res, "code, validFrom and validTo are required", 400);
    const c = await prisma.coupon.create({
      data: { stationId, code: code.toUpperCase(), module: module || "Fuel", discountType: discountType || "Percentage", discountValue: discountValue || 0, minSpend: minSpend || 0, maxUses: maxUses || 0, validFrom, validTo, status },
    });
    ok(res, c, 201);
  } catch (e) { err(res, e.message); }
}

async function updateCoupon(req, res) {
  try {
    const { code, module, discountType, discountValue, minSpend, maxUses, usedCount, validFrom, validTo, status } = req.body;
    const data = {};
    if (code          !== undefined) data.code          = code.toUpperCase();
    if (module        !== undefined) data.module        = module;
    if (discountType  !== undefined) data.discountType  = discountType;
    if (discountValue !== undefined) data.discountValue = discountValue;
    if (minSpend      !== undefined) data.minSpend      = minSpend;
    if (maxUses       !== undefined) data.maxUses       = maxUses;
    if (usedCount     !== undefined) data.usedCount     = usedCount;
    if (validFrom     !== undefined) data.validFrom     = validFrom;
    if (validTo       !== undefined) data.validTo       = validTo;
    if (status        !== undefined) data.status        = status;
    const c = await prisma.coupon.update({ where: { id: req.params.id }, data });
    ok(res, c);
  } catch (e) { err(res, e.message); }
}

async function deleteCoupon(req, res) {
  try {
    await prisma.coupon.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Client Orders ─────────────────────────────────────────────────────────────

async function listOrders(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { status, module, clientId, page = "1", limit = "50" } = req.query;
    const pageNum  = Math.max(1, parseInt(page,  10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const where = { stationId };
    if (status)   where.status   = status;
    if (module)   where.module   = module;
    if (clientId) where.clientId = clientId;
    const [data, total] = await prisma.$transaction([
      prisma.clientOrder.findMany({ where, orderBy: { createdAt: "desc" }, skip: (pageNum - 1) * limitNum, take: limitNum }),
      prisma.clientOrder.count({ where }),
    ]);
    ok(res, data, 200, { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) });
  } catch (e) { err(res, e.message); }
}

async function createOrder(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { clientId, clientName, module = "Fuel", description, amount = 0, paymentMethod = "Cash", status = "pending", orderDate, notes } = req.body;
    if (!clientName)  return err(res, "clientName is required", 400);
    if (!description) return err(res, "description is required", 400);
    const orderRef = `ORD-${Date.now().toString(36).toUpperCase()}`;
    const o = await prisma.clientOrder.create({
      data: { stationId, clientId: clientId || null, clientName, orderRef, module, description, amount: parseFloat(amount), paymentMethod, status, orderDate: orderDate || new Date().toISOString().split("T")[0], notes: notes || null },
    });
    ok(res, o, 201);
  } catch (e) { err(res, e.message); }
}

async function updateOrder(req, res) {
  try {
    const { clientName, module, description, amount, paymentMethod, status, orderDate, notes } = req.body;
    const data = {};
    if (clientName    !== undefined) data.clientName    = clientName;
    if (module        !== undefined) data.module        = module;
    if (description   !== undefined) data.description   = description;
    if (amount        !== undefined) data.amount        = parseFloat(amount);
    if (paymentMethod !== undefined) data.paymentMethod = paymentMethod;
    if (status        !== undefined) data.status        = status;
    if (orderDate     !== undefined) data.orderDate     = orderDate;
    if (notes         !== undefined) data.notes         = notes;
    const o = await prisma.clientOrder.update({ where: { id: req.params.id }, data });
    ok(res, o);
  } catch (e) { err(res, e.message); }
}

async function deleteOrder(req, res) {
  try {
    await prisma.clientOrder.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

module.exports = { listClients, createClient, updateClient, deleteClient, listCoupons, createCoupon, updateCoupon, deleteCoupon, listOrders, createOrder, updateOrder, deleteOrder };
