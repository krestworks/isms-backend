"use strict";
const prisma = require("../config/prisma");
const { hasPermission } = require("../services/permissionService");

const FUEL_TYPES    = ["Super", "Diesel", "Kerosene", "V-Power", "Jet A-1", "Heavy Fuel Oil"];
const TANK_STATUSES = ["operational", "low", "critical", "maintenance"];
const PAY_METHODS   = ["Cash", "M-Pesa", "Card", "Invoice", "Cheque"];

// ── helpers ───────────────────────────────────────────────────────────────────

/** Resolve the active station for the request.
 *  Managers → their homeLocation station.
 *  Admins    → x-station-id header (required). */
async function resolveStation(req) {
  const canViewAll = await hasPermission(req.user.sub, "global", "stations.view");
  const headerId   = req.headers["x-station-id"];

  if (canViewAll) {
    if (headerId && headerId !== "global") return headerId;
    return null; // admin without header → operate across all stations in list calls
  }

  // Non-admin: always use their homeLocation station
  const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { homeLocation: true } });
  if (!user?.homeLocation) return null;
  const station = await prisma.station.findFirst({ where: { name: user.homeLocation, deletedAt: null } });
  return station?.id ?? null;
}

function toISODay(dateStr) {
  // "2026-05-23" → "2026-05-23T00:00:00.000Z"
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function receiptNo() {
  return `F-${Date.now().toString(36).toUpperCase()}`;
}

// ── TANKS ─────────────────────────────────────────────────────────────────────

async function listTanks(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const where = stationId ? { stationId } : {};
    const tanks = await prisma.fuelTank.findMany({ where, orderBy: { name: "asc" } });
    res.json({ success: true, data: tanks });
  } catch (err) { next(err); }
}

async function createTank(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(422).json({ success: false, message: "Station context required" });

    const { name, fuelType, capacity, currentLevel = 0, status = "operational" } = req.body;
    if (!name?.trim()) return res.status(422).json({ success: false, message: "Tank name is required" });
    if (!FUEL_TYPES.includes(fuelType)) return res.status(422).json({ success: false, message: `fuelType must be one of: ${FUEL_TYPES.join(", ")}` });
    if (!capacity || capacity <= 0) return res.status(422).json({ success: false, message: "Capacity must be > 0" });

    const exists = await prisma.fuelTank.findUnique({ where: { name_stationId: { name: name.trim(), stationId } } });
    if (exists) return res.status(409).json({ success: false, message: "A tank with this name already exists at this station" });

    const tank = await prisma.fuelTank.create({
      data: { stationId, name: name.trim(), fuelType, capacity: +capacity, currentLevel: +currentLevel, status },
    });
    res.status(201).json({ success: true, message: "Tank created", data: tank });
  } catch (err) { next(err); }
}

async function updateTank(req, res, next) {
  try {
    const { name, fuelType, capacity, currentLevel, lastDipReading, status } = req.body;
    const tank = await prisma.fuelTank.findUnique({ where: { id: req.params.id } });
    if (!tank) return res.status(404).json({ success: false, message: "Tank not found" });

    if (fuelType && !FUEL_TYPES.includes(fuelType))
      return res.status(422).json({ success: false, message: `fuelType must be one of: ${FUEL_TYPES.join(", ")}` });
    if (status && !TANK_STATUSES.includes(status))
      return res.status(422).json({ success: false, message: `status must be one of: ${TANK_STATUSES.join(", ")}` });

    if (name && name.trim() !== tank.name) {
      const conflict = await prisma.fuelTank.findUnique({
        where: { name_stationId: { name: name.trim(), stationId: tank.stationId } },
      });
      if (conflict) return res.status(409).json({ success: false, message: "Tank name already taken at this station" });
    }

    const updated = await prisma.fuelTank.update({
      where: { id: req.params.id },
      data: {
        name:           name           ? name.trim()         : undefined,
        fuelType:       fuelType       || undefined,
        capacity:       capacity       != null ? +capacity   : undefined,
        currentLevel:   currentLevel   != null ? +currentLevel : undefined,
        lastDipReading: lastDipReading != null ? +lastDipReading : undefined,
        status:         status         || undefined,
      },
    });
    res.json({ success: true, message: "Tank updated", data: updated });
  } catch (err) { next(err); }
}

async function deleteTank(req, res, next) {
  try {
    const tank = await prisma.fuelTank.findUnique({ where: { id: req.params.id } });
    if (!tank) return res.status(404).json({ success: false, message: "Tank not found" });

    const hasSales = await prisma.fuelSale.count({ where: { tankId: req.params.id } });
    if (hasSales > 0) return res.status(409).json({ success: false, message: "Cannot delete a tank with recorded sales" });

    await prisma.fuelTank.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Tank deleted" });
  } catch (err) { next(err); }
}

async function recordDip(req, res, next) {
  try {
    const { reading } = req.body;
    if (reading == null || reading < 0) return res.status(422).json({ success: false, message: "Invalid dip reading" });

    const tank = await prisma.fuelTank.findUnique({ where: { id: req.params.id } });
    if (!tank) return res.status(404).json({ success: false, message: "Tank not found" });

    const newStatus = reading / tank.capacity < 0.1 ? "critical"
      : reading / tank.capacity < 0.2 ? "low"
      : "operational";

    const updated = await prisma.fuelTank.update({
      where: { id: req.params.id },
      data: { lastDipReading: +reading, currentLevel: +reading, status: newStatus },
    });
    res.json({ success: true, message: "Dip reading recorded", data: updated });
  } catch (err) { next(err); }
}

// ── SALES ─────────────────────────────────────────────────────────────────────

async function listSales(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const { from, to, fuelType, paymentMethod } = req.query;

    const where = { ...(stationId ? { stationId } : {}) };
    if (fuelType) where.fuelType = fuelType;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = toISODay(from);
      if (to)   where.date.lte = new Date(`${to}T23:59:59.999Z`);
    }

    const sales = await prisma.fuelSale.findMany({
      where,
      include: { tank: { select: { id: true, name: true } } },
      orderBy: { date: "desc" },
    });
    res.json({ success: true, data: sales });
  } catch (err) { next(err); }
}

async function createSale(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(422).json({ success: false, message: "Station context required" });

    const {
      tankId, pumpNumber, fuelType, litres, pricePerLitre,
      discount = 0, attendant, paymentMethod = "Cash", paymentStatus = "paid",
      customer, date,
    } = req.body;

    if (!fuelType || !litres || !pricePerLitre || !pumpNumber || !date)
      return res.status(422).json({ success: false, message: "fuelType, litres, pricePerLitre, pumpNumber, date are required" });

    const amount    = +litres * +pricePerLitre;
    const netAmount = amount - +discount;

    const sale = await prisma.fuelSale.create({
      data: {
        stationId,
        tankId: tankId || null,
        pumpNumber: +pumpNumber,
        fuelType,
        litres: +litres,
        pricePerLitre: +pricePerLitre,
        amount,
        discount: +discount,
        netAmount,
        attendant: attendant?.trim() || null,
        paymentMethod,
        paymentStatus,
        customer: customer?.trim() || null,
        receiptNo: receiptNo(),
        date: toISODay(date),
      },
      include: { tank: { select: { id: true, name: true } } },
    });

    // Deduct from tank level
    if (tankId) {
      await prisma.fuelTank.update({
        where: { id: tankId },
        data: { currentLevel: { decrement: +litres } },
      });
    }

    res.status(201).json({ success: true, message: "Sale recorded", data: sale });
  } catch (err) { next(err); }
}

async function updateSale(req, res, next) {
  try {
    const sale = await prisma.fuelSale.findUnique({ where: { id: req.params.id } });
    if (!sale) return res.status(404).json({ success: false, message: "Sale not found" });

    const { litres, pricePerLitre, discount, attendant, paymentMethod, paymentStatus, customer } = req.body;
    const newLitres = litres != null ? +litres : sale.litres;
    const newPpl    = pricePerLitre != null ? +pricePerLitre : sale.pricePerLitre;
    const newDisc   = discount != null ? +discount : sale.discount;
    const amount    = newLitres * newPpl;
    const netAmount = amount - newDisc;

    const updated = await prisma.fuelSale.update({
      where: { id: req.params.id },
      data: {
        litres: newLitres, pricePerLitre: newPpl, amount, discount: newDisc, netAmount,
        attendant: attendant !== undefined ? attendant?.trim() || null : undefined,
        paymentMethod: paymentMethod || undefined,
        paymentStatus: paymentStatus || undefined,
        customer: customer !== undefined ? customer?.trim() || null : undefined,
      },
      include: { tank: { select: { id: true, name: true } } },
    });
    res.json({ success: true, message: "Sale updated", data: updated });
  } catch (err) { next(err); }
}

async function voidSale(req, res, next) {
  try {
    const sale = await prisma.fuelSale.findUnique({ where: { id: req.params.id } });
    if (!sale) return res.status(404).json({ success: false, message: "Sale not found" });

    // Restore tank level
    if (sale.tankId) {
      await prisma.fuelTank.update({
        where: { id: sale.tankId },
        data: { currentLevel: { increment: sale.litres } },
      });
    }

    await prisma.fuelSale.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Sale voided" });
  } catch (err) { next(err); }
}

// ── DELIVERIES ────────────────────────────────────────────────────────────────

async function listDeliveries(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const { from, to } = req.query;
    const where = { ...(stationId ? { stationId } : {}) };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = toISODay(from);
      if (to)   where.date.lte = new Date(`${to}T23:59:59.999Z`);
    }
    const deliveries = await prisma.fuelDelivery.findMany({
      where,
      include: { tank: { select: { id: true, name: true, fuelType: true } } },
      orderBy: { date: "desc" },
    });
    res.json({ success: true, data: deliveries });
  } catch (err) { next(err); }
}

async function createDelivery(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(422).json({ success: false, message: "Station context required" });

    const { tankId, litres, supplier, deliveryNote, date } = req.body;
    if (!tankId || !litres || !date)
      return res.status(422).json({ success: false, message: "tankId, litres, date are required" });

    const tank = await prisma.fuelTank.findUnique({ where: { id: tankId } });
    if (!tank || tank.stationId !== stationId)
      return res.status(404).json({ success: false, message: "Tank not found" });

    const delivery = await prisma.fuelDelivery.create({
      data: {
        stationId, tankId, litres: +litres,
        supplier: supplier?.trim() || null,
        deliveryNote: deliveryNote?.trim() || null,
        date: toISODay(date),
        recordedBy: req.user.sub,
      },
      include: { tank: { select: { id: true, name: true, fuelType: true } } },
    });

    // Top up tank
    await prisma.fuelTank.update({
      where: { id: tankId },
      data: {
        currentLevel: { increment: +litres },
        lastDeliveryDate: toISODay(date),
        lastDeliveryAmount: +litres,
        status: "operational",
      },
    });

    res.status(201).json({ success: true, message: "Delivery recorded", data: delivery });
  } catch (err) { next(err); }
}

// ── RECONCILIATIONS ───────────────────────────────────────────────────────────

async function listReconciliations(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const { from, to } = req.query;
    const where = { ...(stationId ? { stationId } : {}) };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = toISODay(from);
      if (to)   where.date.lte = new Date(`${to}T23:59:59.999Z`);
    }
    const records = await prisma.fuelReconciliation.findMany({
      where,
      include: { tank: { select: { id: true, name: true } } },
      orderBy: { date: "desc" },
    });
    res.json({ success: true, data: records });
  } catch (err) { next(err); }
}

async function createReconciliation(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(422).json({ success: false, message: "Station context required" });

    const { fuelType, tankId, date, openingStock, deliveries: deliveryLitres = 0,
            expectedSales, actualSales, closingStockActual, notes } = req.body;

    if (!fuelType || !date || openingStock == null || expectedSales == null || actualSales == null || closingStockActual == null)
      return res.status(422).json({ success: false, message: "fuelType, date, openingStock, expectedSales, actualSales, closingStockActual are required" });

    const closingStockExpected = +openingStock + +deliveryLitres - +expectedSales;
    const variance             = +closingStockActual - closingStockExpected;
    const variancePct          = closingStockExpected !== 0 ? (variance / closingStockExpected) * 100 : 0;
    const status               = Math.abs(variancePct) < 0.1 ? "matched" : variance < 0 ? "under" : "over";

    const rec = await prisma.fuelReconciliation.create({
      data: {
        stationId, fuelType, tankId: tankId || null,
        date: toISODay(date),
        openingStock: +openingStock, deliveries: +deliveryLitres,
        expectedSales: +expectedSales, actualSales: +actualSales,
        closingStockExpected, closingStockActual: +closingStockActual,
        variance, variancePct, status,
        notes: notes?.trim() || null,
      },
      include: { tank: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, message: "Reconciliation saved", data: rec });
  } catch (err) { next(err); }
}

async function approveReconciliation(req, res, next) {
  try {
    const rec = await prisma.fuelReconciliation.findUnique({ where: { id: req.params.id } });
    if (!rec) return res.status(404).json({ success: false, message: "Reconciliation not found" });

    const updated = await prisma.fuelReconciliation.update({
      where: { id: req.params.id },
      data: { approvedBy: req.user.sub, approvedAt: new Date() },
    });
    res.json({ success: true, message: "Reconciliation approved", data: updated });
  } catch (err) { next(err); }
}

// ── PRODUCTS (pricing / inventory config) ─────────────────────────────────────

async function listProducts(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const where = stationId ? { stationId } : {};
    const products = await prisma.fuelProduct.findMany({ where, orderBy: { fuelType: "asc" } });
    res.json({ success: true, data: products });
  } catch (err) { next(err); }
}

async function upsertProduct(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) return res.status(422).json({ success: false, message: "Station context required" });

    const { fuelType, buyingPrice, markedPrice, sellingPrice, reorderLevel, supplier, supplierContact, isActive } = req.body;
    if (!fuelType || !FUEL_TYPES.includes(fuelType))
      return res.status(422).json({ success: false, message: `fuelType must be one of: ${FUEL_TYPES.join(", ")}` });

    const product = await prisma.fuelProduct.upsert({
      where: { stationId_fuelType: { stationId, fuelType } },
      update: {
        buyingPrice:     buyingPrice     != null ? +buyingPrice     : undefined,
        markedPrice:     markedPrice     != null ? +markedPrice     : undefined,
        sellingPrice:    sellingPrice    != null ? +sellingPrice    : undefined,
        reorderLevel:    reorderLevel    != null ? +reorderLevel    : undefined,
        supplier:        supplier        !== undefined ? supplier?.trim()        || null : undefined,
        supplierContact: supplierContact !== undefined ? supplierContact?.trim() || null : undefined,
        isActive:        isActive        !== undefined ? Boolean(isActive)              : undefined,
      },
      create: {
        stationId, fuelType,
        buyingPrice:     +(buyingPrice  ?? 0),
        markedPrice:     +(markedPrice  ?? 0),
        sellingPrice:    +(sellingPrice ?? 0),
        reorderLevel:    +(reorderLevel ?? 5000),
        supplier:        supplier?.trim()        || null,
        supplierContact: supplierContact?.trim() || null,
        isActive:        isActive !== undefined ? Boolean(isActive) : true,
      },
    });
    res.json({ success: true, message: "Product saved", data: product });
  } catch (err) { next(err); }
}

async function deleteProduct(req, res, next) {
  try {
    const product = await prisma.fuelProduct.findUnique({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    await prisma.fuelProduct.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Product deleted" });
  } catch (err) { next(err); }
}

// ── SUMMARY (dashboard) ───────────────────────────────────────────────────────

async function getSummary(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const today     = new Date().toISOString().split("T")[0];
    const from      = toISODay(today);
    const to        = new Date(`${today}T23:59:59.999Z`);

    const saleWhere = { date: { gte: from, lte: to }, ...(stationId ? { stationId } : {}) };

    const [todaySales, tanks, criticalTanks] = await Promise.all([
      prisma.fuelSale.aggregate({
        where: saleWhere,
        _sum: { netAmount: true, litres: true },
        _count: { id: true },
      }),
      prisma.fuelTank.count({ where: stationId ? { stationId } : {} }),
      prisma.fuelTank.count({ where: { status: { in: ["low", "critical"] }, ...(stationId ? { stationId } : {}) } }),
    ]);

    res.json({
      success: true,
      data: {
        todayRevenue:   todaySales._sum.netAmount  ?? 0,
        todayLitres:    todaySales._sum.litres      ?? 0,
        todayTransactions: todaySales._count.id,
        totalTanks:     tanks,
        alertTanks:     criticalTanks,
      },
    });
  } catch (err) { next(err); }
}

module.exports = {
  listTanks, createTank, updateTank, deleteTank, recordDip,
  listSales, createSale, updateSale, voidSale,
  listDeliveries, createDelivery,
  listReconciliations, createReconciliation, approveReconciliation,
  listProducts, upsertProduct, deleteProduct,
  getSummary,
};
