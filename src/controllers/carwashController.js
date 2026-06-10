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
const receiptNo  = () => `CWS-${Date.now().toString(36).toUpperCase()}`;
const bookingRef = () => `BK-${Date.now().toString(36).toUpperCase()}`;
const ticketNo   = () => `CW-${Date.now().toString(36).toUpperCase()}`;

// ── Sales ─────────────────────────────────────────────────────────────────────

exports.listSales = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { from, to, status, paymentMethod } = req.query;
    const where = {
      stationId,
      ...(from || to ? { date: { ...(from && { gte: toISO(from) }), ...(to && { lte: new Date(to + "T23:59:59.999Z") }) } } : {}),
      ...(status && { status }),
      ...(paymentMethod && { paymentMethod }),
    };
    const data = await prisma.carwashSale.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createSale = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, vehicleReg, washPackage, attendant, paymentMethod = "Cash", amount = 0, status = "paid" } = req.body;
    if (!date || !vehicleReg || !washPackage) return res.status(400).json({ success: false, message: "date, vehicleReg, washPackage required" });
    const data = await prisma.carwashSale.create({
      data: { stationId, receiptNo: receiptNo(), date: toISO(date), vehicleReg, washPackage,
        attendant, paymentMethod, amount: +amount, status }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateSale = async (req, res) => {
  try {
    const { date, vehicleReg, washPackage, attendant, paymentMethod, amount, status } = req.body;
    const data = await prisma.carwashSale.update({
      where: { id: req.params.id },
      data: { ...(date && { date: toISO(date) }), vehicleReg, washPackage, attendant,
        paymentMethod, ...(amount != null && { amount: +amount }), status }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteSale = async (req, res) => {
  try {
    await prisma.carwashSale.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Bookings ──────────────────────────────────────────────────────────────────

exports.listBookings = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { from, to, status } = req.query;
    const where = {
      stationId,
      ...(from || to ? { date: { ...(from && { gte: toISO(from) }), ...(to && { lte: new Date(to + "T23:59:59.999Z") }) } } : {}),
      ...(status && { status }),
    };
    const data = await prisma.carwashBooking.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createBooking = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, time, client, phone, vehicleReg, washPackage, status = "pending" } = req.body;
    if (!date || !client || !vehicleReg || !washPackage) return res.status(400).json({ success: false, message: "date, client, vehicleReg, washPackage required" });
    const data = await prisma.carwashBooking.create({
      data: { stationId, bookingRef: bookingRef(), date: toISO(date), time, client, phone, vehicleReg, washPackage, status }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateBooking = async (req, res) => {
  try {
    const { date, time, client, phone, vehicleReg, washPackage, status } = req.body;
    const data = await prisma.carwashBooking.update({
      where: { id: req.params.id },
      data: { ...(date && { date: toISO(date) }), time, client, phone, vehicleReg, washPackage, status }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteBooking = async (req, res) => {
  try {
    await prisma.carwashBooking.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Staff ─────────────────────────────────────────────────────────────────────

exports.listStaff = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { status, shift } = req.query;
    const data = await prisma.carwashStaff.findMany({
      where: { stationId, ...(status && { status }), ...(shift && { shift }) },
      orderBy: { name: "asc" }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createStaff = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { name, phone, role = "Washer", shift = "Morning", rating = 0, washesCompleted = 0, status = "on_duty" } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "name required" });
    const data = await prisma.carwashStaff.create({
      data: { stationId, name, phone, role, shift, rating: +rating, washesCompleted: +washesCompleted, status }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateStaff = async (req, res) => {
  try {
    const { name, phone, role, shift, rating, washesCompleted, status } = req.body;
    const data = await prisma.carwashStaff.update({
      where: { id: req.params.id },
      data: { name, phone, role, shift,
        ...(rating != null && { rating: +rating }),
        ...(washesCompleted != null && { washesCompleted: +washesCompleted }),
        status }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteStaff = async (req, res) => {
  try {
    await prisma.carwashStaff.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Queue ─────────────────────────────────────────────────────────────────────

exports.listQueue = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { from, to, status, washPackage } = req.query;
    const where = {
      stationId,
      ...(from || to ? { date: { ...(from && { gte: toISO(from) }), ...(to && { lte: new Date(to + "T23:59:59.999Z") }) } } : {}),
      ...(status && { status }),
      ...(washPackage && { washPackage }),
    };
    const data = await prisma.carwashQueue.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createQueue = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, vehicleReg, vehicleType = "Sedan", washPackage, assignedTo, amount = 0, status = "waiting" } = req.body;
    if (!date || !vehicleReg || !washPackage) return res.status(400).json({ success: false, message: "date, vehicleReg, washPackage required" });
    const data = await prisma.carwashQueue.create({
      data: { stationId, ticketNo: ticketNo(), date: toISO(date), vehicleReg, vehicleType,
        washPackage, assignedTo, amount: +amount, status }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateQueue = async (req, res) => {
  try {
    const { date, vehicleReg, vehicleType, washPackage, assignedTo, amount, status } = req.body;
    const data = await prisma.carwashQueue.update({
      where: { id: req.params.id },
      data: { ...(date && { date: toISO(date) }), vehicleReg, vehicleType, washPackage,
        assignedTo, ...(amount != null && { amount: +amount }), status }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteQueue = async (req, res) => {
  try {
    await prisma.carwashQueue.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Packages ──────────────────────────────────────────────────────────────────

exports.listPackages = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { status } = req.query;
    const data = await prisma.carwashPackage.findMany({
      where: { stationId, ...(status && { status }) },
      orderBy: { name: "asc" }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createPackage = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { name, description, duration = 30, price = 0, vehicleTypes = "All", status = "active" } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "name required" });
    const data = await prisma.carwashPackage.create({
      data: { stationId, name, description, duration: +duration, price: +price, vehicleTypes, status }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updatePackage = async (req, res) => {
  try {
    const { name, description, duration, price, vehicleTypes, status } = req.body;
    const data = await prisma.carwashPackage.update({
      where: { id: req.params.id },
      data: { name, description, ...(duration != null && { duration: +duration }),
        ...(price != null && { price: +price }), vehicleTypes, status }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deletePackage = async (req, res) => {
  try {
    await prisma.carwashPackage.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
