const { PrismaClient } = require("@prisma/client");
const permissionService = require("../services/permissionService");
const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveStation(req) {
  const hasSV = await permissionService.hasPermission(req.user.sub, "global", "stations.view");
  if (hasSV) {
    const h = req.headers["x-station-id"];
    return h && h !== "global" ? h : null;
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { homeLocation: true } });
  return user?.homeLocation ?? null;
}

const toISO = (d) => d ? new Date(d + "T00:00:00.000Z") : null;
const receiptNo = () => `W-${Date.now().toString(36).toUpperCase()}`;
const orderNo = () => `WO-${Date.now().toString(36).toUpperCase()}`;
const invoiceNo = () => `WINV-${Date.now().toString(36).toUpperCase()}`;

// ── Production ────────────────────────────────────────────────────────────────

exports.listProduction = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { from, to, shift, status } = req.query;
    const where = {
      stationId,
      ...(from || to ? { date: { ...(from && { gte: toISO(from) }), ...(to && { lte: new Date(to + "T23:59:59.999Z") }) } } : {}),
      ...(shift && { shift }),
      ...(status && { status }),
    };
    const data = await prisma.waterProduction.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createProduction = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, shift = "Morning", litresProduced, litresWasted = 0, operator, machineId, status = "active", notes } = req.body;
    if (!date || litresProduced == null) return res.status(400).json({ success: false, message: "date and litresProduced required" });
    const lp = +litresProduced; const lw = +litresWasted;
    const data = await prisma.waterProduction.create({
      data: { stationId, date: toISO(date), shift, litresProduced: lp, litresWasted: lw, netOutput: lp - lw, operator, machineId, status, notes }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateProduction = async (req, res) => {
  try {
    const { date, shift, litresProduced, litresWasted, operator, machineId, status, notes } = req.body;
    const lp = litresProduced != null ? +litresProduced : undefined;
    const lw = litresWasted != null ? +litresWasted : undefined;
    const data = await prisma.waterProduction.update({
      where: { id: req.params.id },
      data: { ...(date && { date: toISO(date) }), shift,
        ...(lp != null && { litresProduced: lp }), ...(lw != null && { litresWasted: lw }),
        ...(lp != null && lw != null && { netOutput: lp - lw }),
        operator, machineId, status, notes }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteProduction = async (req, res) => {
  try {
    await prisma.waterProduction.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Equipment ─────────────────────────────────────────────────────────────────

exports.listEquipment = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { status, type } = req.query;
    const data = await prisma.waterEquipment.findMany({
      where: { stationId, ...(status && { status }), ...(type && { type }) },
      orderBy: { name: "asc" }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createEquipment = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { name, type, serialNo, status = "operational", lastMaintenance, nextMaintenance, location } = req.body;
    if (!name || !type) return res.status(400).json({ success: false, message: "name and type required" });
    const data = await prisma.waterEquipment.create({
      data: { stationId, name, type, serialNo, status,
        ...(lastMaintenance && { lastMaintenance: toISO(lastMaintenance) }),
        ...(nextMaintenance && { nextMaintenance: toISO(nextMaintenance) }), location }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateEquipment = async (req, res) => {
  try {
    const { name, type, serialNo, status, lastMaintenance, nextMaintenance, location } = req.body;
    const data = await prisma.waterEquipment.update({
      where: { id: req.params.id },
      data: { name, type, serialNo, status,
        ...(lastMaintenance !== undefined && { lastMaintenance: lastMaintenance ? toISO(lastMaintenance) : null }),
        ...(nextMaintenance !== undefined && { nextMaintenance: nextMaintenance ? toISO(nextMaintenance) : null }),
        location }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteEquipment = async (req, res) => {
  try {
    await prisma.waterEquipment.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Sales ─────────────────────────────────────────────────────────────────────

exports.listSales = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { from, to, paymentStatus, paymentMethod } = req.query;
    const where = {
      stationId,
      ...(from || to ? { date: { ...(from && { gte: toISO(from) }), ...(to && { lte: new Date(to + "T23:59:59.999Z") }) } } : {}),
      ...(paymentStatus && { paymentStatus }),
      ...(paymentMethod && { paymentMethod }),
    };
    const data = await prisma.waterSale.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createSale = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, customer, litres, pricePerLitre, discount = 0, paymentMethod = "Cash", paymentStatus = "paid", attendant } = req.body;
    if (!date || litres == null || pricePerLitre == null) return res.status(400).json({ success: false, message: "date, litres, pricePerLitre required" });
    const l = +litres; const p = +pricePerLitre; const d = +discount;
    const data = await prisma.waterSale.create({
      data: { stationId, date: toISO(date), receiptNo: receiptNo(), customer, litres: l, pricePerLitre: p,
        discount: d, totalAmount: l * p - d, paymentMethod, paymentStatus, attendant }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateSale = async (req, res) => {
  try {
    const { date, customer, litres, pricePerLitre, discount, paymentMethod, paymentStatus, attendant } = req.body;
    const l = litres != null ? +litres : undefined; const p = pricePerLitre != null ? +pricePerLitre : undefined; const d = discount != null ? +discount : undefined;
    const data = await prisma.waterSale.update({
      where: { id: req.params.id },
      data: { ...(date && { date: toISO(date) }), customer,
        ...(l != null && { litres: l }), ...(p != null && { pricePerLitre: p }),
        ...(d != null && { discount: d }),
        ...(l != null && p != null && d != null && { totalAmount: l * p - d }),
        paymentMethod, paymentStatus, attendant }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.voidSale = async (req, res) => {
  try {
    await prisma.waterSale.update({ where: { id: req.params.id }, data: { paymentStatus: "voided" } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Orders ────────────────────────────────────────────────────────────────────

exports.listOrders = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { from, to, orderStatus, paymentStatus } = req.query;
    const where = {
      stationId,
      ...(from || to ? { date: { ...(from && { gte: toISO(from) }), ...(to && { lte: new Date(to + "T23:59:59.999Z") }) } } : {}),
      ...(orderStatus && { orderStatus }),
      ...(paymentStatus && { paymentStatus }),
    };
    const data = await prisma.waterOrder.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createOrder = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, client, clientPhone, litres, pricePerLitre, paymentMethod = "Cash",
      paymentStatus = "pending", orderStatus = "pending", processedBy, deliveredBy, deliveryAddress, deliveryDate, notes } = req.body;
    if (!date || !client || litres == null) return res.status(400).json({ success: false, message: "date, client, litres required" });
    const l = +litres; const p = +pricePerLitre || 0;
    const data = await prisma.waterOrder.create({
      data: { stationId, orderNo: orderNo(), date: toISO(date), client, clientPhone, litres: l, pricePerLitre: p,
        totalAmount: l * p, orderStatus, paymentStatus, paymentMethod, processedBy, deliveredBy,
        deliveryAddress, ...(deliveryDate && { deliveryDate: toISO(deliveryDate) }), notes }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateOrder = async (req, res) => {
  try {
    const { date, client, clientPhone, litres, pricePerLitre, orderStatus, paymentStatus, paymentMethod,
      processedBy, deliveredBy, deliveryAddress, deliveryDate, notes } = req.body;
    const l = litres != null ? +litres : undefined; const p = pricePerLitre != null ? +pricePerLitre : undefined;
    const data = await prisma.waterOrder.update({
      where: { id: req.params.id },
      data: { ...(date && { date: toISO(date) }), client, clientPhone,
        ...(l != null && { litres: l }), ...(p != null && { pricePerLitre: p }),
        ...(l != null && p != null && { totalAmount: l * p }),
        orderStatus, paymentStatus, paymentMethod, processedBy, deliveredBy, deliveryAddress,
        ...(deliveryDate !== undefined && { deliveryDate: deliveryDate ? toISO(deliveryDate) : null }), notes }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteOrder = async (req, res) => {
  try {
    await prisma.waterOrder.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Distribution ──────────────────────────────────────────────────────────────

exports.listDistribution = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { from, to, status } = req.query;
    const where = {
      stationId,
      ...(from || to ? { date: { ...(from && { gte: toISO(from) }), ...(to && { lte: new Date(to + "T23:59:59.999Z") }) } } : {}),
      ...(status && { status }),
    };
    const data = await prisma.waterDistribution.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createDistribution = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, vehicle, driver, destination, litresLoaded, litresDelivered = 0, client, status = "active", departureTime, arrivalTime } = req.body;
    if (!date || litresLoaded == null) return res.status(400).json({ success: false, message: "date and litresLoaded required" });
    const ll = +litresLoaded; const ld = +litresDelivered;
    const data = await prisma.waterDistribution.create({
      data: { stationId, date: toISO(date), vehicle, driver, destination, litresLoaded: ll, litresDelivered: ld,
        variance: ld - ll, client, status, departureTime, arrivalTime }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateDistribution = async (req, res) => {
  try {
    const { date, vehicle, driver, destination, litresLoaded, litresDelivered, client, status, departureTime, arrivalTime } = req.body;
    const ll = litresLoaded != null ? +litresLoaded : undefined; const ld = litresDelivered != null ? +litresDelivered : undefined;
    const data = await prisma.waterDistribution.update({
      where: { id: req.params.id },
      data: { ...(date && { date: toISO(date) }), vehicle, driver, destination,
        ...(ll != null && { litresLoaded: ll }), ...(ld != null && { litresDelivered: ld }),
        ...(ll != null && ld != null && { variance: ld - ll }),
        client, status, departureTime, arrivalTime }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteDistribution = async (req, res) => {
  try {
    await prisma.waterDistribution.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Invoices ──────────────────────────────────────────────────────────────────

exports.listInvoices = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { status, type } = req.query;
    const data = await prisma.waterInvoice.findMany({
      where: { stationId, ...(status && { status }), ...(type && { type }) },
      orderBy: { date: "desc" }
    });
    res.json({ success: true, data: data.map(i => ({ ...i, items: JSON.parse(i.items || "[]") })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createInvoice = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, dueDate, client, type = "TAX INVOICE", items = [], status = "pending" } = req.body;
    if (!date || !client) return res.status(400).json({ success: false, message: "date and client required" });
    const subtotal = items.reduce((s, i) => s + ((+i.litres || 0) * (+i.rate || 0)), 0);
    const vatAmount = Math.round(subtotal * 0.16);
    const data = await prisma.waterInvoice.create({
      data: { stationId, invoiceNo: invoiceNo(), date: toISO(date),
        ...(dueDate && { dueDate: toISO(dueDate) }), client, type,
        items: JSON.stringify(items), subtotal, vatAmount, totalAmount: subtotal + vatAmount, status }
    });
    res.status(201).json({ success: true, data: { ...data, items } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateInvoice = async (req, res) => {
  try {
    const { date, dueDate, client, type, items, status } = req.body;
    const updData = {
      ...(date && { date: toISO(date) }),
      ...(dueDate !== undefined && { dueDate: dueDate ? toISO(dueDate) : null }),
      client, type, status,
    };
    if (items) {
      const sub = items.reduce((s, i) => s + ((+i.litres || 0) * (+i.rate || 0)), 0);
      const va = Math.round(sub * 0.16);
      Object.assign(updData, { items: JSON.stringify(items), subtotal: sub, vatAmount: va, totalAmount: sub + va });
    }
    const data = await prisma.waterInvoice.update({ where: { id: req.params.id }, data: updData });
    res.json({ success: true, data: { ...data, items: JSON.parse(data.items || "[]") } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteInvoice = async (req, res) => {
  try {
    await prisma.waterInvoice.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Summary ───────────────────────────────────────────────────────────────────

exports.getSummary = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setUTCHours(23, 59, 59, 999);
    const [sales, production, equipment] = await Promise.all([
      prisma.waterSale.findMany({ where: { stationId, date: { gte: todayStart, lte: todayEnd }, paymentStatus: { not: "voided" } } }),
      prisma.waterProduction.findMany({ where: { stationId, date: { gte: todayStart, lte: todayEnd } } }),
      prisma.waterEquipment.findMany({ where: { stationId } }),
    ]);
    const todayRevenue = sales.reduce((s, r) => s + r.totalAmount, 0);
    const todayLitresSold = sales.reduce((s, r) => s + r.litres, 0);
    const todayProduced = production.reduce((s, r) => s + r.netOutput, 0);
    const maintenanceEquipment = equipment.filter(e => e.status === "maintenance").length;
    res.json({ success: true, data: { todayRevenue, todayLitresSold, todayProduced, totalEquipment: equipment.length, maintenanceEquipment } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
