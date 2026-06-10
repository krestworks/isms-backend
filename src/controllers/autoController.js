const { PrismaClient } = require("@prisma/client");
const permissionService = require("../services/permissionService");
const prisma = new PrismaClient();

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
const serviceNo  = () => `SR-${Date.now().toString(36).toUpperCase()}`;
const billNo     = () => `BL-${Date.now().toString(36).toUpperCase()}`;
const invoiceNo  = () => `AI-${Date.now().toString(36).toUpperCase()}`;

// ── Service Records ───────────────────────────────────────────────────────────

exports.listServiceRecords = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { from, to, status, serviceType } = req.query;
    const where = {
      stationId,
      ...(from || to ? { date: { ...(from && { gte: toISO(from) }), ...(to && { lte: new Date(to + "T23:59:59.999Z") }) } } : {}),
      ...(status && { status }),
      ...(serviceType && { serviceType }),
    };
    const data = await prisma.autoServiceRecord.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createServiceRecord = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, vehicleReg, vehicleMake, customerName, customerPhone, serviceType, description,
      technician, estimatedCost = 0, actualCost = 0, status = "pending", startTime, endTime } = req.body;
    if (!date || !vehicleReg || !customerName || !serviceType)
      return res.status(400).json({ success: false, message: "date, vehicleReg, customerName, serviceType required" });
    const data = await prisma.autoServiceRecord.create({
      data: { stationId, serviceNo: serviceNo(), date: toISO(date), vehicleReg, vehicleMake,
        customerName, customerPhone, serviceType, description, technician,
        estimatedCost: +estimatedCost, actualCost: +actualCost, status, startTime, endTime }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateServiceRecord = async (req, res) => {
  try {
    const { date, vehicleReg, vehicleMake, customerName, customerPhone, serviceType, description,
      technician, estimatedCost, actualCost, status, startTime, endTime } = req.body;
    const data = await prisma.autoServiceRecord.update({
      where: { id: req.params.id },
      data: { ...(date && { date: toISO(date) }), vehicleReg, vehicleMake, customerName, customerPhone,
        serviceType, description, technician,
        ...(estimatedCost != null && { estimatedCost: +estimatedCost }),
        ...(actualCost != null && { actualCost: +actualCost }),
        status, startTime, endTime }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteServiceRecord = async (req, res) => {
  try {
    await prisma.autoServiceRecord.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Billing ───────────────────────────────────────────────────────────────────

exports.listBills = async (req, res) => {
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
    const data = await prisma.autoBill.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createBill = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, serviceRef, customerName, vehicleReg, labourCharges = 0, partsCost = 0,
      discount = 0, paymentMethod = "Cash", paymentStatus = "pending", paidAmount = 0 } = req.body;
    if (!date || !customerName || !vehicleReg)
      return res.status(400).json({ success: false, message: "date, customerName, vehicleReg required" });
    const lc = +labourCharges; const pc = +partsCost; const dc = +discount; const pa = +paidAmount;
    const total = lc + pc - dc;
    const data = await prisma.autoBill.create({
      data: { stationId, billNo: billNo(), date: toISO(date), serviceRef, customerName, vehicleReg,
        labourCharges: lc, partsCost: pc, discount: dc, totalAmount: total,
        paymentMethod, paymentStatus, paidAmount: pa, balance: total - pa }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateBill = async (req, res) => {
  try {
    const { date, serviceRef, customerName, vehicleReg, labourCharges, partsCost, discount,
      paymentMethod, paymentStatus, paidAmount } = req.body;
    const lc = labourCharges != null ? +labourCharges : undefined;
    const pc = partsCost != null ? +partsCost : undefined;
    const dc = discount != null ? +discount : undefined;
    const pa = paidAmount != null ? +paidAmount : undefined;
    const total = (lc != null && pc != null && dc != null) ? lc + pc - dc : undefined;
    const data = await prisma.autoBill.update({
      where: { id: req.params.id },
      data: { ...(date && { date: toISO(date) }), serviceRef, customerName, vehicleReg,
        ...(lc != null && { labourCharges: lc }), ...(pc != null && { partsCost: pc }),
        ...(dc != null && { discount: dc }), ...(total != null && { totalAmount: total }),
        paymentMethod, paymentStatus,
        ...(pa != null && { paidAmount: pa }),
        ...(total != null && pa != null && { balance: total - pa }) }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteBill = async (req, res) => {
  try {
    await prisma.autoBill.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Invoices ──────────────────────────────────────────────────────────────────

exports.listInvoices = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { status, type } = req.query;
    const data = await prisma.autoInvoice.findMany({
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
    const { date, dueDate, type = "TAX INVOICE", client, vehicleReg, serviceRef, items = [], status = "pending" } = req.body;
    if (!date || !client) return res.status(400).json({ success: false, message: "date and client required" });
    const subtotal = items.reduce((s, i) => s + ((+i.qty || 0) * (+i.rate || 0)), 0);
    const vatAmount = Math.round(subtotal * 0.16);
    const data = await prisma.autoInvoice.create({
      data: { stationId, invoiceNo: invoiceNo(), date: toISO(date),
        ...(dueDate && { dueDate: toISO(dueDate) }), type, client, vehicleReg, serviceRef,
        items: JSON.stringify(items), subtotal, vatAmount, totalAmount: subtotal + vatAmount, status }
    });
    res.status(201).json({ success: true, data: { ...data, items } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateInvoice = async (req, res) => {
  try {
    const { date, dueDate, type, client, vehicleReg, serviceRef, items, status } = req.body;
    const updData = { ...(date && { date: toISO(date) }),
      ...(dueDate !== undefined && { dueDate: dueDate ? toISO(dueDate) : null }),
      type, client, vehicleReg, serviceRef, status };
    if (items) {
      const sub = items.reduce((s, i) => s + ((+i.qty || 0) * (+i.rate || 0)), 0);
      const va = Math.round(sub * 0.16);
      Object.assign(updData, { items: JSON.stringify(items), subtotal: sub, vatAmount: va, totalAmount: sub + va });
    }
    const data = await prisma.autoInvoice.update({ where: { id: req.params.id }, data: updData });
    res.json({ success: true, data: { ...data, items: JSON.parse(data.items || "[]") } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteInvoice = async (req, res) => {
  try {
    await prisma.autoInvoice.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Parts ─────────────────────────────────────────────────────────────────────

exports.listParts = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { status, category } = req.query;
    const data = await prisma.autoPart.findMany({
      where: { stationId, ...(status && { status }), ...(category && { category }) },
      orderBy: { name: "asc" }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createPart = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { name, category, partNumber, supplier, buyingPrice = 0, sellingPrice = 0, stockQty = 0, reorderLevel = 5, status = "in-stock" } = req.body;
    if (!name || !category) return res.status(400).json({ success: false, message: "name and category required" });
    const data = await prisma.autoPart.create({
      data: { stationId, name, category, partNumber, supplier,
        buyingPrice: +buyingPrice, sellingPrice: +sellingPrice, stockQty: +stockQty,
        reorderLevel: +reorderLevel, status }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updatePart = async (req, res) => {
  try {
    const { name, category, partNumber, supplier, buyingPrice, sellingPrice, stockQty, reorderLevel, status } = req.body;
    const data = await prisma.autoPart.update({
      where: { id: req.params.id },
      data: { name, category, partNumber, supplier,
        ...(buyingPrice != null && { buyingPrice: +buyingPrice }),
        ...(sellingPrice != null && { sellingPrice: +sellingPrice }),
        ...(stockQty != null && { stockQty: +stockQty }),
        ...(reorderLevel != null && { reorderLevel: +reorderLevel }),
        status }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deletePart = async (req, res) => {
  try {
    await prisma.autoPart.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Service Pricing ───────────────────────────────────────────────────────────

exports.listPricing = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { status, category } = req.query;
    const data = await prisma.autoServicePrice.findMany({
      where: { stationId, ...(status && { status }), ...(category && { category }) },
      orderBy: { serviceName: "asc" }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createPricing = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { serviceName, category, labourCost = 0, partsEstimate = 0, duration, warranty, status = "active" } = req.body;
    if (!serviceName || !category) return res.status(400).json({ success: false, message: "serviceName and category required" });
    const lc = +labourCost; const pe = +partsEstimate;
    const data = await prisma.autoServicePrice.create({
      data: { stationId, serviceName, category, labourCost: lc, partsEstimate: pe,
        totalPrice: lc + pe, duration, warranty, status }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updatePricing = async (req, res) => {
  try {
    const { serviceName, category, labourCost, partsEstimate, duration, warranty, status } = req.body;
    const lc = labourCost != null ? +labourCost : undefined;
    const pe = partsEstimate != null ? +partsEstimate : undefined;
    const data = await prisma.autoServicePrice.update({
      where: { id: req.params.id },
      data: { serviceName, category, ...(lc != null && { labourCost: lc }),
        ...(pe != null && { partsEstimate: pe }),
        ...(lc != null && pe != null && { totalPrice: lc + pe }),
        duration, warranty, status }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deletePricing = async (req, res) => {
  try {
    await prisma.autoServicePrice.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Technicians ───────────────────────────────────────────────────────────────

exports.listTechnicians = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { status, specialization } = req.query;
    const data = await prisma.autoTechnician.findMany({
      where: { stationId, ...(status && { status }), ...(specialization && { specialization }) },
      orderBy: { name: "asc" }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createTechnician = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { name, phone, specialization, experience, certifications, dailyRate = 0, jobsCompleted = 0, rating = 0, status = "active" } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "name required" });
    const data = await prisma.autoTechnician.create({
      data: { stationId, name, phone, specialization, experience, certifications,
        dailyRate: +dailyRate, jobsCompleted: +jobsCompleted, rating: +rating, status }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateTechnician = async (req, res) => {
  try {
    const { name, phone, specialization, experience, certifications, dailyRate, jobsCompleted, rating, status } = req.body;
    const data = await prisma.autoTechnician.update({
      where: { id: req.params.id },
      data: { name, phone, specialization, experience, certifications,
        ...(dailyRate != null && { dailyRate: +dailyRate }),
        ...(jobsCompleted != null && { jobsCompleted: +jobsCompleted }),
        ...(rating != null && { rating: +rating }),
        status }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteTechnician = async (req, res) => {
  try {
    await prisma.autoTechnician.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
