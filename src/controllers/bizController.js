"use strict";
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const pesapal = require("../services/pesapalService");

const today = () => new Date().toISOString().split("T")[0];
const saleRef  = () => "BS-"  + Date.now().toString(36).toUpperCase();
const orderRef = () => "PO-"  + Date.now().toString(36).toUpperCase();
const kitRef   = () => "KO-"  + Date.now().toString(36).toUpperCase();

async function resolveStation(req) {
  const { hasPermission } = require("../services/permissionService");
  const isAdmin = await hasPermission(req.user.sub, "global", "stations.view");
  if (isAdmin) {
    const h = req.headers["x-station-id"];
    return h && h !== "global" ? h : null;
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { homeLocation: true } });
  return user?.homeLocation ?? null;
}

const ok  = (res, data, status = 200) => res.status(status).json({ success: true,  data });
const err = (res, msg, status = 500) => res.status(status).json({ success: false, error: msg });

// ── Businesses ────────────────────────────────────────────────────────────────

async function listBusinesses(req, res) {
  try {
    const stationId = await resolveStation(req);
    const data = await prisma.bizBusiness.findMany({ where: { stationId }, orderBy: { name: "asc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function getBusiness(req, res) {
  try {
    const b = await prisma.bizBusiness.findUnique({ where: { id: req.params.id } });
    if (!b) return err(res, "Not found", 404);
    ok(res, b);
  } catch (e) { err(res, e.message); }
}

async function createBusiness(req, res) {
  try {
    const stationId = await resolveStation(req);
    const { type, name, taxRate, currency, receiptHeader, receiptFooter } = req.body;
    if (!type || !name) return err(res, "type and name required", 400);
    const b = await prisma.bizBusiness.create({
      data: { stationId, type, name, taxRate: taxRate ?? 16, currency: currency ?? "KES", receiptHeader, receiptFooter },
    });
    ok(res, b, 201);
  } catch (e) { err(res, e.message); }
}

async function updateBusiness(req, res) {
  try {
    const b = await prisma.bizBusiness.update({ where: { id: req.params.id }, data: req.body });
    ok(res, b);
  } catch (e) { err(res, e.message); }
}

async function deleteBusiness(req, res) {
  try {
    await prisma.bizBusiness.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Categories ────────────────────────────────────────────────────────────────

async function listCategories(req, res) {
  try {
    const { businessId } = req.query;
    if (!businessId) return err(res, "businessId required", 400);
    const data = await prisma.bizCategory.findMany({ where: { businessId }, orderBy: { name: "asc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function createCategory(req, res) {
  try {
    const c = await prisma.bizCategory.create({ data: req.body });
    ok(res, c, 201);
  } catch (e) { err(res, e.message); }
}

async function updateCategory(req, res) {
  try {
    const c = await prisma.bizCategory.update({ where: { id: req.params.id }, data: req.body });
    ok(res, c);
  } catch (e) { err(res, e.message); }
}

async function deleteCategory(req, res) {
  try {
    await prisma.bizCategory.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Products ──────────────────────────────────────────────────────────────────

async function listProducts(req, res) {
  try {
    const { businessId, categoryId, status, lowStock } = req.query;
    if (!businessId) return err(res, "businessId required", 400);
    const where = { businessId };
    if (categoryId) where.categoryId = categoryId;
    if (status)     where.status     = status;
    let data = await prisma.bizProduct.findMany({ where, orderBy: { name: "asc" } });
    if (lowStock === "true") data = data.filter(p => p.stockQty <= p.reorderLevel);
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function createProduct(req, res) {
  try {
    const { businessId, name, categoryId, categoryName, sku, barcode, description,
            markedPrice, price, costPrice, unit, stockQty, reorderLevel,
            expiryDate, requiresPrescription, status } = req.body;
    if (!businessId || !name) return err(res, "businessId and name required", 400);
    const p = await prisma.bizProduct.create({
      data: {
        businessId, name, categoryId, categoryName, sku, barcode, description,
        markedPrice: markedPrice ?? 0,
        price: price ?? 0, costPrice: costPrice ?? 0, unit: unit ?? "pcs",
        stockQty: stockQty ?? 0, reorderLevel: reorderLevel ?? 5,
        expiryDate, requiresPrescription: requiresPrescription ?? false,
        status: status ?? "active",
      },
    });
    ok(res, p, 201);
  } catch (e) { err(res, e.message); }
}

async function updateProduct(req, res) {
  try {
    const { createdAt, updatedAt, id, ...data } = req.body;
    const p = await prisma.bizProduct.update({ where: { id: req.params.id }, data });
    ok(res, p);
  } catch (e) { err(res, e.message); }
}

async function deleteProduct(req, res) {
  try {
    await prisma.bizProduct.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

async function adjustStock(req, res) {
  try {
    const { productId, type, qty, notes, reference } = req.body;
    if (!productId || !type || qty == null) return err(res, "productId, type, qty required", 400);
    const product = await prisma.bizProduct.findUnique({ where: { id: productId } });
    if (!product) return err(res, "Product not found", 404);

    const before = product.stockQty;
    let after = before;
    if (type === "adjustment") after = qty;
    else if (["purchase_in", "return"].includes(type)) after = before + qty;
    else if (["sale_out", "wastage"].includes(type))  after = before - qty;

    const [updated] = await prisma.$transaction([
      prisma.bizProduct.update({ where: { id: productId }, data: { stockQty: after } }),
      prisma.bizStockMovement.create({
        data: {
          businessId: product.businessId, productId, productName: product.name,
          type, qty, before, after, reference, notes, date: today(),
        },
      }),
    ]);
    ok(res, updated);
  } catch (e) { err(res, e.message); }
}

async function bulkUpdateStock(req, res) {
  try {
    const { businessId, rows } = req.body;
    if (!businessId || !Array.isArray(rows) || !rows.length)
      return err(res, "businessId and rows[] required", 400);

    const products = await prisma.bizProduct.findMany({ where: { businessId } });
    const results = { updated: 0, notFound: 0, errors: 0 };

    for (const row of rows) {
      const match = products.find(p =>
        (row.sku     && p.sku     === row.sku)     ||
        (row.barcode && p.barcode === row.barcode) ||
        p.name.toLowerCase() === (row.name ?? "").toLowerCase()
      );
      if (!match) { results.notFound++; continue; }

      try {
        const type   = row.type || "adjustment";
        const qty    = parseFloat(row.newQty) || 0;
        const before = match.stockQty;
        let   after  = before;
        if (type === "adjustment") after = qty;
        else if (["purchase_in","return"].includes(type))    after = before + qty;
        else if (["sale_out","wastage"].includes(type))      after = before - qty;

        await prisma.$transaction([
          prisma.bizProduct.update({ where: { id: match.id }, data: { stockQty: after } }),
          prisma.bizStockMovement.create({
            data: {
              businessId, productId: match.id, productName: match.name,
              type, qty, before, after,
              notes: row.notes || "Bulk stock update", date: today(),
            },
          }),
        ]);
        results.updated++;
      } catch { results.errors++; }
    }

    ok(res, results);
  } catch (e) { err(res, e.message); }
}

// ── Suppliers ─────────────────────────────────────────────────────────────────

async function listSuppliers(req, res) {
  try {
    const { businessId } = req.query;
    if (!businessId) return err(res, "businessId required", 400);
    const data = await prisma.bizSupplier.findMany({ where: { businessId }, orderBy: { name: "asc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function createSupplier(req, res) {
  try {
    const s = await prisma.bizSupplier.create({ data: req.body });
    ok(res, s, 201);
  } catch (e) { err(res, e.message); }
}

async function updateSupplier(req, res) {
  try {
    const s = await prisma.bizSupplier.update({ where: { id: req.params.id }, data: req.body });
    ok(res, s);
  } catch (e) { err(res, e.message); }
}

async function deleteSupplier(req, res) {
  try {
    await prisma.bizSupplier.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Purchase Orders ───────────────────────────────────────────────────────────

async function listPurchaseOrders(req, res) {
  try {
    const { businessId, status } = req.query;
    if (!businessId) return err(res, "businessId required", 400);
    const where = { businessId };
    if (status) where.status = status;
    const data = await prisma.bizPurchaseOrder.findMany({ where, orderBy: { createdAt: "desc" } });
    const parsed = data.map(o => ({ ...o, items: safeJson(o.items, []) }));
    ok(res, parsed);
  } catch (e) { err(res, e.message); }
}

async function createPurchaseOrder(req, res) {
  try {
    const { items, ...rest } = req.body;
    const subtotal = (items || []).reduce((s, i) => s + (i.totalCost ?? 0), 0);
    const o = await prisma.bizPurchaseOrder.create({
      data: { ...rest, orderRef: orderRef(), items: JSON.stringify(items || []), subtotal, totalAmount: subtotal },
    });
    ok(res, { ...o, items: safeJson(o.items, []) }, 201);
  } catch (e) { err(res, e.message); }
}

async function updatePurchaseOrder(req, res) {
  try {
    const { items, ...rest } = req.body;
    const data = { ...rest };
    if (items) { data.items = JSON.stringify(items); data.subtotal = items.reduce((s, i) => s + (i.totalCost ?? 0), 0); data.totalAmount = data.subtotal; }
    const o = await prisma.bizPurchaseOrder.update({ where: { id: req.params.id }, data });
    ok(res, { ...o, items: safeJson(o.items, []) });
  } catch (e) { err(res, e.message); }
}

async function receivePurchaseOrder(req, res) {
  try {
    const order = await prisma.bizPurchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return err(res, "Order not found", 404);
    const items = safeJson(order.items, []);

    const ops = [
      prisma.bizPurchaseOrder.update({ where: { id: order.id }, data: { status: "received", receivedAt: today() } }),
    ];
    for (const item of items) {
      if (!item.productId) continue;
      const product = await prisma.bizProduct.findUnique({ where: { id: item.productId } });
      if (!product) continue;
      const before = product.stockQty;
      const after  = before + (item.qty ?? 0);
      ops.push(
        prisma.bizProduct.update({ where: { id: item.productId }, data: { stockQty: after } }),
        prisma.bizStockMovement.create({
          data: {
            businessId: order.businessId, productId: item.productId, productName: item.productName ?? product.name,
            type: "purchase_in", qty: item.qty ?? 0, before, after,
            reference: order.orderRef, notes: "Purchase order received", date: today(),
          },
        }),
      );
    }
    await prisma.$transaction(ops);
    ok(res, { id: order.id, status: "received" });
  } catch (e) { err(res, e.message); }
}

async function deletePurchaseOrder(req, res) {
  try {
    await prisma.bizPurchaseOrder.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Sales (POS) ───────────────────────────────────────────────────────────────

async function listSales(req, res) {
  try {
    const { businessId, from, to, status } = req.query;
    if (!businessId) return err(res, "businessId required", 400);
    const where = { businessId };
    if (status) where.status = status;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to)   where.date.lte = to;
    }
    const data = await prisma.bizSale.findMany({ where, orderBy: { createdAt: "desc" } });
    ok(res, data.map(s => ({ ...s, items: safeJson(s.items, []) })));
  } catch (e) { err(res, e.message); }
}

async function createSale(req, res) {
  try {
    const { items, businessId, discount = 0, paymentMethod = "Cash", amountPaid, cashier, tableId, tableNo, notes } = req.body;
    if (!businessId || !items?.length) return err(res, "businessId and items required", 400);

    const business = await prisma.bizBusiness.findUnique({ where: { id: businessId } });
    const taxRate  = business?.taxRate ?? 0;

    const subtotal    = items.reduce((s, i) => s + (i.totalPrice ?? i.qty * i.unitPrice), 0);
    const taxAmount   = Math.round(subtotal * taxRate / 100 * 100) / 100;
    const totalAmount = subtotal - discount + taxAmount;
    const change      = Math.max(0, (amountPaid ?? totalAmount) - totalAmount);

    const ops = [
      prisma.bizSale.create({
        data: {
          businessId, saleRef: saleRef(), date: today(),
          items: JSON.stringify(items), subtotal, discount, taxRate, taxAmount, totalAmount,
          paymentMethod, amountPaid: amountPaid ?? totalAmount, change, cashier, tableId, tableNo, notes,
          status: "paid",
        },
      }),
    ];

    for (const item of items) {
      if (!item.productId) continue;
      const product = await prisma.bizProduct.findUnique({ where: { id: item.productId } });
      if (!product) continue;
      const before = product.stockQty;
      const after  = before - item.qty;
      ops.push(
        prisma.bizProduct.update({ where: { id: item.productId }, data: { stockQty: after } }),
        prisma.bizStockMovement.create({
          data: {
            businessId, productId: item.productId, productName: item.name ?? product.name,
            type: "sale_out", qty: item.qty, before, after,
            reference: "POS Sale", date: today(),
          },
        }),
      );
    }

    const results = await prisma.$transaction(ops);
    const sale = results[0];
    ok(res, { ...sale, items: safeJson(sale.items, []) }, 201);
  } catch (e) { err(res, e.message); }
}

async function voidSale(req, res) {
  try {
    const sale = await prisma.bizSale.findUnique({ where: { id: req.params.id } });
    if (!sale) return err(res, "Sale not found", 404);

    const items = safeJson(sale.items, []);
    const ops = [
      prisma.bizSale.update({ where: { id: sale.id }, data: { status: "void" } }),
    ];
    for (const item of items) {
      if (!item.productId) continue;
      const product = await prisma.bizProduct.findUnique({ where: { id: item.productId } });
      if (!product) continue;
      const before = product.stockQty;
      const after  = before + item.qty;
      ops.push(
        prisma.bizProduct.update({ where: { id: item.productId }, data: { stockQty: after } }),
        prisma.bizStockMovement.create({
          data: {
            businessId: sale.businessId, productId: item.productId, productName: item.name ?? product.name,
            type: "return", qty: item.qty, before, after,
            reference: sale.saleRef, notes: "Sale voided", date: today(),
          },
        }),
      );
    }
    await prisma.$transaction(ops);
    ok(res, { id: sale.id, status: "void" });
  } catch (e) { err(res, e.message); }
}

// ── Stock Movements ───────────────────────────────────────────────────────────

async function listStockMovements(req, res) {
  try {
    const { businessId, productId, type, from, to } = req.query;
    if (!businessId) return err(res, "businessId required", 400);
    const where = { businessId };
    if (productId) where.productId = productId;
    if (type)      where.type      = type;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to)   where.date.lte = to;
    }
    const data = await prisma.bizStockMovement.findMany({ where, orderBy: { createdAt: "desc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

// ── Expenses ──────────────────────────────────────────────────────────────────

async function listExpenses(req, res) {
  try {
    const { businessId, from, to } = req.query;
    if (!businessId) return err(res, "businessId required", 400);
    const where = { businessId };
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = from;
      if (to)   where.date.lte = to;
    }
    const data = await prisma.bizExpense.findMany({ where, orderBy: { createdAt: "desc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function createExpense(req, res) {
  try {
    const e2 = await prisma.bizExpense.create({ data: { ...req.body, date: req.body.date || today() } });
    ok(res, e2, 201);
  } catch (e) { err(res, e.message); }
}

async function updateExpense(req, res) {
  try {
    const e2 = await prisma.bizExpense.update({ where: { id: req.params.id }, data: req.body });
    ok(res, e2);
  } catch (e) { err(res, e.message); }
}

async function deleteExpense(req, res) {
  try {
    await prisma.bizExpense.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Tables (restaurant) ───────────────────────────────────────────────────────

async function listTables(req, res) {
  try {
    const { businessId } = req.query;
    if (!businessId) return err(res, "businessId required", 400);
    const data = await prisma.bizTable.findMany({ where: { businessId }, orderBy: { tableNo: "asc" } });
    ok(res, data);
  } catch (e) { err(res, e.message); }
}

async function createTable(req, res) {
  try {
    const t = await prisma.bizTable.create({ data: req.body });
    ok(res, t, 201);
  } catch (e) { err(res, e.message); }
}

async function updateTable(req, res) {
  try {
    const t = await prisma.bizTable.update({ where: { id: req.params.id }, data: req.body });
    ok(res, t);
  } catch (e) { err(res, e.message); }
}

async function deleteTable(req, res) {
  try {
    await prisma.bizTable.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Kitchen Orders (restaurant) ───────────────────────────────────────────────

async function listKitchenOrders(req, res) {
  try {
    const { businessId, status } = req.query;
    if (!businessId) return err(res, "businessId required", 400);
    const where = { businessId };
    if (status) where.status = status;
    const data = await prisma.bizKitchenOrder.findMany({ where, orderBy: { createdAt: "desc" } });
    ok(res, data.map(o => ({ ...o, items: safeJson(o.items, []) })));
  } catch (e) { err(res, e.message); }
}

async function createKitchenOrder(req, res) {
  try {
    const { items, ...rest } = req.body;
    const o = await prisma.bizKitchenOrder.create({
      data: { ...rest, orderRef: kitRef(), items: JSON.stringify(items || []) },
    });
    ok(res, { ...o, items: safeJson(o.items, []) }, 201);
  } catch (e) { err(res, e.message); }
}

async function updateKitchenOrder(req, res) {
  try {
    const { items, ...rest } = req.body;
    const data = { ...rest };
    if (items) data.items = JSON.stringify(items);
    const o = await prisma.bizKitchenOrder.update({ where: { id: req.params.id }, data });
    ok(res, { ...o, items: safeJson(o.items, []) });
  } catch (e) { err(res, e.message); }
}

async function deleteKitchenOrder(req, res) {
  try {
    await prisma.bizKitchenOrder.delete({ where: { id: req.params.id } });
    ok(res, { id: req.params.id });
  } catch (e) { err(res, e.message); }
}

// ── Reports ───────────────────────────────────────────────────────────────────

async function getSummary(req, res) {
  try {
    const { businessId, from, to } = req.query;
    if (!businessId) return err(res, "businessId required", 400);

    const dateFilt = {};
    if (from) dateFilt.gte = from;
    if (to)   dateFilt.lte = to;
    const dateWhere = Object.keys(dateFilt).length ? { date: dateFilt } : {};

    const [sales, expenses, products, stockMovements] = await Promise.all([
      prisma.bizSale.findMany({ where: { businessId, status: { not: "void" }, ...dateWhere } }),
      prisma.bizExpense.findMany({ where: { businessId, ...dateWhere } }),
      prisma.bizProduct.findMany({ where: { businessId } }),
      prisma.bizStockMovement.findMany({ where: { businessId, type: "sale_out", ...dateWhere } }),
    ]);

    const revenue      = sales.reduce((s, x) => s + x.totalAmount, 0);
    const totalExpenses = expenses.reduce((s, x) => s + x.amount, 0);
    const totalProducts = products.length;
    const lowStock      = products.filter(p => p.stockQty <= p.reorderLevel && p.status === "active").length;
    const outOfStock    = products.filter(p => p.stockQty <= 0 && p.status === "active").length;

    // top 5 products by qty sold
    const soldMap = {};
    for (const m of stockMovements) {
      soldMap[m.productName] = (soldMap[m.productName] ?? 0) + m.qty;
    }
    const topProducts = Object.entries(soldMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, qty]) => ({ name, qty }));

    // sales by payment method
    const payMap = {};
    for (const s of sales) payMap[s.paymentMethod] = (payMap[s.paymentMethod] ?? 0) + s.totalAmount;
    const byPayment = Object.entries(payMap).map(([method, amount]) => ({ method, amount }));

    ok(res, { revenue, totalExpenses, profit: revenue - totalExpenses, totalSales: sales.length, totalProducts, lowStock, outOfStock, topProducts, byPayment });
  } catch (e) { err(res, e.message); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeJson(v, fallback) {
  try { return typeof v === "string" ? JSON.parse(v) : (v ?? fallback); }
  catch { return fallback; }
}

// Deduct stock for a completed sale — shared by createSale and payment confirmation
async function deductStock(sale, items) {
  const ops = [];
  for (const item of items) {
    if (!item.productId) continue;
    const product = await prisma.bizProduct.findUnique({ where: { id: item.productId } });
    if (!product) continue;
    const before = product.stockQty;
    const after  = before - item.qty;
    ops.push(
      prisma.bizProduct.update({ where: { id: item.productId }, data: { stockQty: after } }),
      prisma.bizStockMovement.create({
        data: {
          businessId: sale.businessId, productId: item.productId,
          productName: item.name ?? product.name,
          type: "sale_out", qty: item.qty, before, after,
          reference: sale.saleRef, date: today(),
        },
      }),
    );
  }
  return ops;
}

// ── Products — barcode/SKU lookup ─────────────────────────────────────────────

async function getProductByBarcode(req, res) {
  try {
    const { code } = req.params;
    const { businessId } = req.query;
    if (!businessId) return err(res, "businessId required", 400);

    const product = await prisma.bizProduct.findFirst({
      where: {
        businessId,
        OR: [{ barcode: code }, { sku: code }],
      },
    });

    if (!product) return err(res, "Product not found", 404);
    ok(res, product);
  } catch (e) { err(res, e.message); }
}

// ── Payments — Pesapal (M-Pesa / Card) ───────────────────────────────────────

/**
 * POST /biz/payments/initiate
 * Creates a pending BizSale and submits it to Pesapal.
 * Returns { saleId, saleRef, trackingId, redirectUrl, amount }.
 */
async function initiatePayment(req, res) {
  try {
    const {
      items, businessId, discount = 0,
      paymentMethod, customerPhone,
      cashier, tableId, tableNo, notes,
    } = req.body;

    if (!businessId || !items?.length) return err(res, "businessId and items required", 400);
    if (!["M-Pesa", "Card"].includes(paymentMethod)) {
      return err(res, "initiatePayment only supports M-Pesa and Card", 400);
    }
    if (paymentMethod === "M-Pesa" && !customerPhone) {
      return err(res, "customerPhone is required for M-Pesa payments", 400);
    }

    const business = await prisma.bizBusiness.findUnique({ where: { id: businessId } });
    const taxRate  = business?.taxRate ?? 0;

    const subtotal    = items.reduce((s, i) => s + (i.totalPrice ?? i.qty * i.unitPrice), 0);
    const taxAmount   = Math.round(subtotal * taxRate / 100 * 100) / 100;
    const totalAmount = Math.max(0, subtotal - discount + taxAmount);

    const ref = saleRef();

    // Create a pending sale (stock NOT deducted yet — deducted on confirmation)
    const sale = await prisma.bizSale.create({
      data: {
        businessId, saleRef: ref, date: today(),
        items: JSON.stringify(items), subtotal, discount, taxRate, taxAmount, totalAmount,
        paymentMethod, amountPaid: 0, change: 0,
        cashier: cashier || null, tableId: tableId || null, tableNo: tableNo || null,
        notes: notes || null,
        status: "pending_payment",
        customerPhone: customerPhone || null,
        pesapalStatus: "pending",
      },
    });

    // Submit order to Pesapal
    let pesapalResult;
    try {
      pesapalResult = await pesapal.submitOrder({
        merchantRef: ref,
        amount: totalAmount,
        currency: business?.currency || "KES",
        description: `${business?.name || "POS"} — ${ref}`,
        phone: customerPhone || undefined,
      });
    } catch (pesapalErr) {
      // Roll back the pending sale if Pesapal rejects
      await prisma.bizSale.delete({ where: { id: sale.id } });
      return err(res, `Pesapal error: ${pesapalErr.message}`, 502);
    }

    if (!pesapalResult?.order_tracking_id) {
      await prisma.bizSale.delete({ where: { id: sale.id } });
      return err(res, "Pesapal did not return a tracking ID", 502);
    }

    // Persist Pesapal tracking data
    await prisma.bizSale.update({
      where: { id: sale.id },
      data: {
        pesapalTrackingId: pesapalResult.order_tracking_id,
        pesapalRedirectUrl: pesapalResult.redirect_url || null,
      },
    });

    ok(res, {
      saleId:      sale.id,
      saleRef:     ref,
      trackingId:  pesapalResult.order_tracking_id,
      redirectUrl: pesapalResult.redirect_url,
      amount:      totalAmount,
    }, 201);
  } catch (e) { err(res, e.message); }
}

/**
 * GET /biz/payments/:trackingId/status
 * Polls Pesapal for payment status. On Completed: deducts stock and marks sale paid.
 * Returns { status: "Completed"|"Pending"|"Failed"|"Invalid"|"Reversed", sale? }
 */
async function checkPaymentStatus(req, res) {
  try {
    const { trackingId } = req.params;

    const sale = await prisma.bizSale.findFirst({
      where: { pesapalTrackingId: trackingId },
    });
    if (!sale) return err(res, "Payment not found", 404);

    // If already finalised, return immediately from DB
    if (sale.status === "paid") {
      return ok(res, { status: "Completed", sale: { ...sale, items: safeJson(sale.items, []) } });
    }
    if (sale.status === "void") {
      return ok(res, { status: "Cancelled", sale: null });
    }

    // Ask Pesapal for latest status
    let statusRes;
    try {
      statusRes = await pesapal.getTransactionStatus(trackingId);
    } catch (e) {
      return ok(res, { status: "Pending", sale: null });
    }

    const code = statusRes.status_code;

    if (pesapal.isCompleted(code)) {
      const items = safeJson(sale.items, []);
      const stockOps = await deductStock(sale, items);

      const [updatedSale] = await prisma.$transaction([
        prisma.bizSale.update({
          where: { id: sale.id },
          data: {
            status: "paid",
            amountPaid: statusRes.amount || sale.totalAmount,
            pesapalStatus: "Completed",
          },
        }),
        ...stockOps,
      ]);

      return ok(res, { status: "Completed", sale: { ...updatedSale, items } });
    }

    if (pesapal.isFailed(code)) {
      const statusStr = pesapal.statusCodeToString(code);
      await prisma.bizSale.update({ where: { id: sale.id }, data: { pesapalStatus: statusStr } });
      return ok(res, { status: statusStr, sale: null });
    }

    // Still pending
    return ok(res, { status: "Pending", sale: null });
  } catch (e) { err(res, e.message); }
}

/**
 * POST /biz/payments/:saleId/cancel
 * Cancels a pending_payment sale (no stock was ever deducted).
 */
async function cancelPayment(req, res) {
  try {
    const sale = await prisma.bizSale.findUnique({ where: { id: req.params.saleId } });
    if (!sale) return err(res, "Sale not found", 404);
    if (sale.status !== "pending_payment") {
      return err(res, "Only pending payments can be cancelled", 409);
    }
    await prisma.bizSale.update({
      where: { id: sale.id },
      data: { status: "void", pesapalStatus: "Cancelled" },
    });
    ok(res, { id: sale.id, status: "void" });
  } catch (e) { err(res, e.message); }
}

/**
 * POST /biz/payments/ipn   (NO authentication — Pesapal posts here)
 * Instant Payment Notification handler.
 */
async function handleIPN(req, res) {
  // Always respond 200 to Pesapal so it doesn't retry
  res.status(200).json({ status: "ok" });

  try {
    const { OrderTrackingId } = req.body;
    if (!OrderTrackingId) return;

    let statusRes;
    try {
      statusRes = await pesapal.getTransactionStatus(OrderTrackingId);
    } catch { return; }

    const code = statusRes.status_code;
    const sale = await prisma.bizSale.findFirst({
      where: { pesapalTrackingId: OrderTrackingId },
    });
    if (!sale || sale.status === "paid") return;

    if (pesapal.isCompleted(code)) {
      const items    = safeJson(sale.items, []);
      const stockOps = await deductStock(sale, items);
      await prisma.$transaction([
        prisma.bizSale.update({
          where: { id: sale.id },
          data: { status: "paid", amountPaid: statusRes.amount || sale.totalAmount, pesapalStatus: "Completed" },
        }),
        ...stockOps,
      ]);
    } else {
      await prisma.bizSale.update({
        where: { id: sale.id },
        data: { pesapalStatus: pesapal.statusCodeToString(code) },
      });
    }
  } catch (e) {
    console.error("[IPN error]", e.message);
  }
}

module.exports = {
  listBusinesses, getBusiness, createBusiness, updateBusiness, deleteBusiness,
  listCategories, createCategory, updateCategory, deleteCategory,
  listProducts, createProduct, updateProduct, deleteProduct, adjustStock, bulkUpdateStock,
  getProductByBarcode,
  listSuppliers, createSupplier, updateSupplier, deleteSupplier,
  listPurchaseOrders, createPurchaseOrder, updatePurchaseOrder, receivePurchaseOrder, deletePurchaseOrder,
  listSales, createSale, voidSale,
  initiatePayment, checkPaymentStatus, cancelPayment, handleIPN,
  listStockMovements,
  listExpenses, createExpense, updateExpense, deleteExpense,
  listTables, createTable, updateTable, deleteTable,
  listKitchenOrders, createKitchenOrder, updateKitchenOrder, deleteKitchenOrder,
  getSummary,
};
