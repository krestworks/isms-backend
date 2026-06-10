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
const receiptNo = () => `L-${Date.now().toString(36).toUpperCase()}`;
const orderNo = () => `LO-${Date.now().toString(36).toUpperCase()}`;
const invoiceNo = () => `LINV-${Date.now().toString(36).toUpperCase()}`;
const batchNo = () => `B-${Date.now().toString(36).toUpperCase()}`;

// ── Cylinders ─────────────────────────────────────────────────────────────────

exports.listCylinders = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { condition, status, size } = req.query;
    const where = { stationId, ...(condition && { condition }), ...(status && { status }), ...(size && { size }) };
    const data = await prisma.lpgCylinder.findMany({ where, orderBy: { createdAt: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createCylinder = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { serialNo, size, weight = 0, condition = "full", status = "available",
      buyingPrice = 0, markedPrice = 0, sellingPrice = 0, supplier, lastRefillDate, location } = req.body;
    if (!serialNo) return res.status(400).json({ success: false, message: "Serial number required" });
    const exists = await prisma.lpgCylinder.findFirst({ where: { serialNo, stationId } });
    if (exists) return res.status(409).json({ success: false, message: "Serial number already exists" });
    const data = await prisma.lpgCylinder.create({
      data: { stationId, serialNo, size, weight: +weight, condition, status,
        buyingPrice: +buyingPrice, markedPrice: +markedPrice, sellingPrice: +sellingPrice,
        supplier, lastRefillDate: toISO(lastRefillDate), location }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateCylinder = async (req, res) => {
  try {
    const { id } = req.params;
    const { serialNo, size, weight, condition, status, buyingPrice, markedPrice, sellingPrice, supplier, lastRefillDate, location } = req.body;
    const data = await prisma.lpgCylinder.update({
      where: { id },
      data: { serialNo, size, ...(weight != null && { weight: +weight }), condition, status,
        ...(buyingPrice != null && { buyingPrice: +buyingPrice }),
        ...(markedPrice != null && { markedPrice: +markedPrice }),
        ...(sellingPrice != null && { sellingPrice: +sellingPrice }),
        supplier, ...(lastRefillDate !== undefined && { lastRefillDate: toISO(lastRefillDate) }), location }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteCylinder = async (req, res) => {
  try {
    await prisma.lpgCylinder.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Sales ─────────────────────────────────────────────────────────────────────

exports.listSales = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { from, to, cylinderSize, paymentStatus, exchangeType } = req.query;
    const where = {
      stationId,
      ...(from || to ? { date: { ...(from && { gte: toISO(from) }), ...(to && { lte: new Date(to + "T23:59:59.999Z") }) } } : {}),
      ...(cylinderSize && { cylinderSize }),
      ...(paymentStatus && { paymentStatus }),
      ...(exchangeType && { exchangeType }),
    };
    const data = await prisma.lpgSale.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createSale = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, customer, cylinderSize, quantity = 1, unitPrice, discount = 0,
      paymentMethod = "Cash", paymentStatus = "paid", attendant, exchangeType = "Exchange" } = req.body;
    if (!date || !cylinderSize || unitPrice == null) return res.status(400).json({ success: false, message: "date, cylinderSize, unitPrice required" });
    const qty = +quantity; const price = +unitPrice; const disc = +discount;
    const totalAmount = qty * price - disc;
    const data = await prisma.lpgSale.create({
      data: { stationId, date: toISO(date), receiptNo: receiptNo(), customer, cylinderSize, quantity: qty,
        unitPrice: price, discount: disc, totalAmount, paymentMethod, paymentStatus, attendant, exchangeType }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.voidSale = async (req, res) => {
  try {
    await prisma.lpgSale.update({ where: { id: req.params.id }, data: { paymentStatus: "voided" } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Refills ───────────────────────────────────────────────────────────────────

exports.listRefills = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { from, to, cylinderSize, status } = req.query;
    const where = {
      stationId,
      ...(from || to ? { date: { ...(from && { gte: toISO(from) }), ...(to && { lte: new Date(to + "T23:59:59.999Z") }) } } : {}),
      ...(cylinderSize && { cylinderSize }),
      ...(status && { status }),
    };
    const data = await prisma.lpgRefill.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createRefill = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, cylinderSize, quantity, costPerUnit, supplier, receivedBy, status = "pending", notes } = req.body;
    if (!date || !cylinderSize || !supplier) return res.status(400).json({ success: false, message: "date, cylinderSize, supplier required" });
    const qty = +quantity || 0; const cpu = +costPerUnit || 0;
    const data = await prisma.lpgRefill.create({
      data: { stationId, date: toISO(date), batchNo: batchNo(), cylinderSize, quantity: qty,
        costPerUnit: cpu, totalCost: qty * cpu, supplier, receivedBy, status, notes }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateRefill = async (req, res) => {
  try {
    const { date, cylinderSize, quantity, costPerUnit, supplier, receivedBy, status, notes } = req.body;
    const qty = quantity != null ? +quantity : undefined; const cpu = costPerUnit != null ? +costPerUnit : undefined;
    const data = await prisma.lpgRefill.update({
      where: { id: req.params.id },
      data: { ...(date && { date: toISO(date) }), cylinderSize, ...(qty != null && { quantity: qty }),
        ...(cpu != null && { costPerUnit: cpu, totalCost: (qty || 0) * cpu }), supplier, receivedBy, status, notes }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Suppliers ─────────────────────────────────────────────────────────────────

exports.listSuppliers = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { status } = req.query;
    const data = await prisma.lpgSupplier.findMany({
      where: { stationId, ...(status && { status }) },
      orderBy: { name: "asc" }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createSupplier = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { name, contactPerson, phone, email, address, cylinderTypes, paymentTerms = "Net 30", rating = 0, status = "active" } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Name required" });
    const exists = await prisma.lpgSupplier.findFirst({ where: { name, stationId } });
    if (exists) return res.status(409).json({ success: false, message: "Supplier already exists" });
    const data = await prisma.lpgSupplier.create({
      data: { stationId, name, contactPerson, phone, email, address, cylinderTypes, paymentTerms, rating: +rating, status }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateSupplier = async (req, res) => {
  try {
    const { name, contactPerson, phone, email, address, cylinderTypes, paymentTerms, rating, status, totalOrders, lastOrderDate } = req.body;
    const data = await prisma.lpgSupplier.update({
      where: { id: req.params.id },
      data: { name, contactPerson, phone, email, address, cylinderTypes, paymentTerms,
        ...(rating != null && { rating: +rating }), status,
        ...(totalOrders != null && { totalOrders: +totalOrders }),
        ...(lastOrderDate !== undefined && { lastOrderDate: toISO(lastOrderDate) }) }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteSupplier = async (req, res) => {
  try {
    await prisma.lpgSupplier.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Orders ────────────────────────────────────────────────────────────────────

exports.listOrders = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { from, to, orderStatus, paymentStatus, cylinderSize } = req.query;
    const where = {
      stationId,
      ...(from || to ? { date: { ...(from && { gte: toISO(from) }), ...(to && { lte: new Date(to + "T23:59:59.999Z") }) } } : {}),
      ...(orderStatus && { orderStatus }),
      ...(paymentStatus && { paymentStatus }),
      ...(cylinderSize && { cylinderSize }),
    };
    const data = await prisma.lpgOrder.findMany({ where, orderBy: { date: "desc" } });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createOrder = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, client, clientPhone, cylinderSize, quantity = 1, unitPrice, paymentMethod = "Cash",
      paymentStatus = "pending", orderStatus = "pending", processedBy, deliveredBy, deliveryAddress, deliveryDate, notes } = req.body;
    if (!date || !client || unitPrice == null) return res.status(400).json({ success: false, message: "date, client, unitPrice required" });
    const qty = +quantity; const price = +unitPrice;
    const data = await prisma.lpgOrder.create({
      data: { stationId, orderNo: orderNo(), date: toISO(date), client, clientPhone, cylinderSize, quantity: qty,
        unitPrice: price, totalAmount: qty * price, orderStatus, paymentStatus, paymentMethod,
        processedBy, deliveredBy, deliveryAddress, ...(deliveryDate && { deliveryDate: toISO(deliveryDate) }), notes }
    });
    res.status(201).json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateOrder = async (req, res) => {
  try {
    const { date, client, clientPhone, cylinderSize, quantity, unitPrice, orderStatus, paymentStatus, paymentMethod,
      processedBy, deliveredBy, deliveryAddress, deliveryDate, notes } = req.body;
    const qty = quantity != null ? +quantity : undefined; const price = unitPrice != null ? +unitPrice : undefined;
    const data = await prisma.lpgOrder.update({
      where: { id: req.params.id },
      data: { ...(date && { date: toISO(date) }), client, clientPhone, cylinderSize,
        ...(qty != null && { quantity: qty }), ...(price != null && { unitPrice: price }),
        ...(qty != null && price != null && { totalAmount: qty * price }),
        orderStatus, paymentStatus, paymentMethod, processedBy, deliveredBy, deliveryAddress,
        ...(deliveryDate !== undefined && { deliveryDate: deliveryDate ? toISO(deliveryDate) : null }), notes }
    });
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteOrder = async (req, res) => {
  try {
    await prisma.lpgOrder.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// ── Invoices ──────────────────────────────────────────────────────────────────

exports.listInvoices = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { paymentStatus, type } = req.query;
    const data = await prisma.lpgInvoice.findMany({
      where: { stationId, ...(paymentStatus && { paymentStatus }), ...(type && { type }) },
      orderBy: { date: "desc" }
    });
    res.json({ success: true, data: data.map(i => ({ ...i, items: JSON.parse(i.items || "[]") })) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.createInvoice = async (req, res) => {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(400).json({ success: false, message: "No station context" });
    const { date, dueDate, client, clientPhone, clientAddress, items = [], vatRate = 16,
      discount = 0, paymentStatus = "pending", paymentMethod = "Invoice", paidDate, type = "invoice" } = req.body;
    if (!date || !client) return res.status(400).json({ success: false, message: "date and client required" });
    const subtotal = items.reduce((s, i) => s + (i.qty * i.unitPrice - (i.discount || 0)), 0);
    const vatAmount = Math.round(subtotal * vatRate / 100);
    const totalAmount = subtotal + vatAmount - +discount;
    const data = await prisma.lpgInvoice.create({
      data: { stationId, invoiceNo: invoiceNo(), date: toISO(date), ...(dueDate && { dueDate: toISO(dueDate) }),
        client, clientPhone, clientAddress, items: JSON.stringify(items), subtotal, vatRate: +vatRate, vatAmount,
        discount: +discount, totalAmount, paymentStatus, paymentMethod, ...(paidDate && { paidDate: toISO(paidDate) }), type }
    });
    res.status(201).json({ success: true, data: { ...data, items } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.updateInvoice = async (req, res) => {
  try {
    const { date, dueDate, client, clientPhone, clientAddress, items, vatRate, discount, paymentStatus, paymentMethod, paidDate, type } = req.body;
    const updData = {
      ...(date && { date: toISO(date) }),
      ...(dueDate !== undefined && { dueDate: dueDate ? toISO(dueDate) : null }),
      client, clientPhone, clientAddress, type, paymentStatus, paymentMethod,
      ...(paidDate !== undefined && { paidDate: paidDate ? toISO(paidDate) : null }),
    };
    if (items) {
      const sub = items.reduce((s, i) => s + (i.qty * i.unitPrice - (i.discount || 0)), 0);
      const vr = vatRate != null ? +vatRate : 16;
      const va = Math.round(sub * vr / 100);
      const disc = discount != null ? +discount : 0;
      Object.assign(updData, { items: JSON.stringify(items), subtotal: sub, vatRate: vr, vatAmount: va, discount: disc, totalAmount: sub + va - disc });
    }
    const data = await prisma.lpgInvoice.update({ where: { id: req.params.id }, data: updData });
    res.json({ success: true, data: { ...data, items: JSON.parse(data.items || "[]") } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.deleteInvoice = async (req, res) => {
  try {
    await prisma.lpgInvoice.delete({ where: { id: req.params.id } });
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
    const [sales, cylinders] = await Promise.all([
      prisma.lpgSale.findMany({ where: { stationId, date: { gte: todayStart, lte: todayEnd }, paymentStatus: { not: "voided" } } }),
      prisma.lpgCylinder.findMany({ where: { stationId } }),
    ]);
    const todayRevenue = sales.reduce((s, r) => s + r.totalAmount, 0);
    const todayTransactions = sales.length;
    const fullCylinders = cylinders.filter(c => c.condition === "full").length;
    const emptyCylinders = cylinders.filter(c => c.condition === "empty").length;
    const damagedCylinders = cylinders.filter(c => c.condition === "damaged").length;
    res.json({ success: true, data: { todayRevenue, todayTransactions, fullCylinders, emptyCylinders, damagedCylinders, totalCylinders: cylinders.length } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};
