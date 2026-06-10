"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const c = require("../controllers/bizController");

const router = Router();

// IPN webhook — Pesapal calls this with no auth token; must be registered before authenticate
router.post("/payments/ipn", c.handleIPN);

router.use(authenticate);

// Businesses
router.get("/businesses",       c.listBusinesses);
router.get("/businesses/:id",   c.getBusiness);
router.post("/businesses",      c.createBusiness);
router.put("/businesses/:id",   c.updateBusiness);
router.delete("/businesses/:id",c.deleteBusiness);

// Categories
router.get("/categories",       c.listCategories);
router.post("/categories",      c.createCategory);
router.put("/categories/:id",   c.updateCategory);
router.delete("/categories/:id",c.deleteCategory);

// Products
router.get("/products/barcode/:code",  c.getProductByBarcode);   // barcode/SKU lookup (before /:id)
router.get("/products",               c.listProducts);
router.post("/products",              c.createProduct);
router.put("/products/:id",           c.updateProduct);
router.delete("/products/:id",        c.deleteProduct);
router.post("/products/adjust-stock", c.adjustStock);
router.post("/products/bulk-stock",   c.bulkUpdateStock);

// Suppliers
router.get("/suppliers",        c.listSuppliers);
router.post("/suppliers",       c.createSupplier);
router.put("/suppliers/:id",    c.updateSupplier);
router.delete("/suppliers/:id", c.deleteSupplier);

// Purchase Orders
router.get("/purchase-orders",              c.listPurchaseOrders);
router.post("/purchase-orders",             c.createPurchaseOrder);
router.put("/purchase-orders/:id",          c.updatePurchaseOrder);
router.post("/purchase-orders/:id/receive", c.receivePurchaseOrder);
router.delete("/purchase-orders/:id",       c.deletePurchaseOrder);

// Sales (POS)
router.get("/sales",            c.listSales);
router.post("/sales",           c.createSale);
router.post("/sales/:id/void",  c.voidSale);

// Payments — Pesapal gateway
router.post("/payments/initiate",                c.initiatePayment);
router.get("/payments/:trackingId/status",       c.checkPaymentStatus);
router.post("/payments/:saleId/cancel",          c.cancelPayment);

// Stock Movements
router.get("/stock-movements",  c.listStockMovements);

// Expenses
router.get("/expenses",         c.listExpenses);
router.post("/expenses",        c.createExpense);
router.put("/expenses/:id",     c.updateExpense);
router.delete("/expenses/:id",  c.deleteExpense);

// Tables (restaurant)
router.get("/tables",           c.listTables);
router.post("/tables",          c.createTable);
router.put("/tables/:id",       c.updateTable);
router.delete("/tables/:id",    c.deleteTable);

// Kitchen Orders (restaurant)
router.get("/kitchen-orders",           c.listKitchenOrders);
router.post("/kitchen-orders",          c.createKitchenOrder);
router.put("/kitchen-orders/:id",       c.updateKitchenOrder);
router.delete("/kitchen-orders/:id",    c.deleteKitchenOrder);

// Reports
router.get("/summary",          c.getSummary);

module.exports = router;
