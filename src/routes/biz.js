"use strict";
const { Router } = require("express");
const { authenticate }       = require("../middleware/auth");
const { requirePermission }  = require("../middleware/authorize");
const c = require("../controllers/bizController");

const router = Router();

// IPN webhook — Pesapal calls this with no auth token; must be registered before authenticate
router.post("/payments/ipn", c.handleIPN);

router.use(authenticate);

// ── Businesses (sub-business setup) ──────────────────────────────────────────
router.get   ("/businesses",        requirePermission("business.setup.manage"), c.listBusinesses);
router.get   ("/businesses/:id",    requirePermission("business.setup.manage"), c.getBusiness);
router.post  ("/businesses",        requirePermission("business.setup.manage"), c.createBusiness);
router.put   ("/businesses/:id",    requirePermission("business.setup.manage"), c.updateBusiness);
router.delete("/businesses/:id",    requirePermission("business.setup.manage"), c.deleteBusiness);

// ── Categories ────────────────────────────────────────────────────────────────
router.get   ("/categories",        requirePermission("business.products.view"),   c.listCategories);
router.post  ("/categories",        requirePermission("business.products.manage"), c.createCategory);
router.put   ("/categories/:id",    requirePermission("business.products.manage"), c.updateCategory);
router.delete("/categories/:id",    requirePermission("business.products.manage"), c.deleteCategory);

// ── Products ──────────────────────────────────────────────────────────────────
router.get   ("/products/barcode/:code", requirePermission("business.pos.record"),     c.getProductByBarcode);
router.get   ("/products",               requirePermission("business.products.view"),   c.listProducts);
router.post  ("/products",               requirePermission("business.products.manage"), c.createProduct);
router.put   ("/products/:id",           requirePermission("business.products.manage"), c.updateProduct);
router.delete("/products/:id",           requirePermission("business.products.manage"), c.deleteProduct);
router.post  ("/products/adjust-stock",  requirePermission("business.stock.adjust"),    c.adjustStock);
router.post  ("/products/bulk-stock",    requirePermission("business.stock.adjust"),    c.bulkUpdateStock);

// ── Suppliers ─────────────────────────────────────────────────────────────────
router.get   ("/suppliers",         requirePermission("business.suppliers.view"),   c.listSuppliers);
router.post  ("/suppliers",         requirePermission("business.suppliers.manage"), c.createSupplier);
router.put   ("/suppliers/:id",     requirePermission("business.suppliers.manage"), c.updateSupplier);
router.delete("/suppliers/:id",     requirePermission("business.suppliers.manage"), c.deleteSupplier);

// ── Purchase Orders ───────────────────────────────────────────────────────────
router.get   ("/purchase-orders",              requirePermission("business.orders.view"),    c.listPurchaseOrders);
router.post  ("/purchase-orders",              requirePermission("business.orders.create"),  c.createPurchaseOrder);
router.put   ("/purchase-orders/:id",          requirePermission("business.orders.create"),  c.updatePurchaseOrder);
router.post  ("/purchase-orders/:id/receive",  requirePermission("business.orders.receive"), c.receivePurchaseOrder);
router.delete("/purchase-orders/:id",          requirePermission("business.orders.create"),  c.deletePurchaseOrder);

// ── Sales (POS) ───────────────────────────────────────────────────────────────
router.get   ("/sales",             requirePermission("business.sales.view"),  c.listSales);
router.post  ("/sales",             requirePermission("business.pos.record"),  c.createSale);
router.post  ("/sales/:id/void",    requirePermission("business.pos.void"),    c.voidSale);

// ── Payments (Pesapal gateway) ────────────────────────────────────────────────
router.post  ("/payments/initiate",                requirePermission("business.pos.record"), c.initiatePayment);
router.get   ("/payments/:trackingId/status",      requirePermission("business.pos.record"), c.checkPaymentStatus);
router.post  ("/payments/:saleId/cancel",          requirePermission("business.pos.record"), c.cancelPayment);

// ── Stock Movements ───────────────────────────────────────────────────────────
router.get   ("/stock-movements",   requirePermission("business.stock.view"), c.listStockMovements);

// ── Expenses ──────────────────────────────────────────────────────────────────
router.get   ("/expenses",          requirePermission("business.expenses.view"),   c.listExpenses);
router.post  ("/expenses",          requirePermission("business.expenses.record"), c.createExpense);
router.put   ("/expenses/:id",      requirePermission("business.expenses.record"), c.updateExpense);
router.delete("/expenses/:id",      requirePermission("business.expenses.record"), c.deleteExpense);

// ── Tables (restaurant) ───────────────────────────────────────────────────────
router.get   ("/tables",            requirePermission("business.restaurant.manage"), c.listTables);
router.post  ("/tables",            requirePermission("business.restaurant.manage"), c.createTable);
router.put   ("/tables/:id",        requirePermission("business.restaurant.manage"), c.updateTable);
router.delete("/tables/:id",        requirePermission("business.restaurant.manage"), c.deleteTable);

// ── Kitchen Orders (restaurant) ───────────────────────────────────────────────
router.get   ("/kitchen-orders",    requirePermission("business.restaurant.manage"), c.listKitchenOrders);
router.post  ("/kitchen-orders",    requirePermission("business.restaurant.manage"), c.createKitchenOrder);
router.put   ("/kitchen-orders/:id",requirePermission("business.restaurant.manage"), c.updateKitchenOrder);
router.delete("/kitchen-orders/:id",requirePermission("business.restaurant.manage"), c.deleteKitchenOrder);

// ── Reports ───────────────────────────────────────────────────────────────────
router.get   ("/summary",           requirePermission("business.reports.view"), c.getSummary);

module.exports = router;
