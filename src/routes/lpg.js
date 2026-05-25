const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const ctrl = require("../controllers/lpgController");

router.use(authenticate);

// Summary
router.get("/summary", requirePermission("lpg.sales.view"), ctrl.getSummary);

// Cylinders
router.get("/cylinders",      requirePermission("lpg.cylinders.view"),   ctrl.listCylinders);
router.post("/cylinders",     requirePermission("lpg.cylinders.manage"),  ctrl.createCylinder);
router.put("/cylinders/:id",  requirePermission("lpg.cylinders.manage"),  ctrl.updateCylinder);
router.delete("/cylinders/:id", requirePermission("lpg.cylinders.manage"), ctrl.deleteCylinder);

// Sales
router.get("/sales",          requirePermission("lpg.sales.view"),        ctrl.listSales);
router.post("/sales",         requirePermission("lpg.sales.record"),       ctrl.createSale);
router.delete("/sales/:id",   requirePermission("lpg.sales.void"),         ctrl.voidSale);

// Refills
router.get("/refills",        requirePermission("lpg.sales.view"),        ctrl.listRefills);
router.post("/refills",       requirePermission("lpg.refills.record"),     ctrl.createRefill);
router.put("/refills/:id",    requirePermission("lpg.refills.record"),     ctrl.updateRefill);

// Suppliers
router.get("/suppliers",        requirePermission("lpg.sales.view"),         ctrl.listSuppliers);
router.post("/suppliers",       requirePermission("lpg.suppliers.manage"),   ctrl.createSupplier);
router.put("/suppliers/:id",    requirePermission("lpg.suppliers.manage"),   ctrl.updateSupplier);
router.delete("/suppliers/:id", requirePermission("lpg.suppliers.manage"),   ctrl.deleteSupplier);

// Orders
router.get("/orders",         requirePermission("lpg.sales.view"),        ctrl.listOrders);
router.post("/orders",        requirePermission("lpg.orders.create"),      ctrl.createOrder);
router.put("/orders/:id",     requirePermission("lpg.orders.create"),      ctrl.updateOrder);
router.delete("/orders/:id",  requirePermission("lpg.orders.create"),      ctrl.deleteOrder);

// Invoices
router.get("/invoices",         requirePermission("lpg.sales.view"),       ctrl.listInvoices);
router.post("/invoices",        requirePermission("lpg.invoices.issue"),    ctrl.createInvoice);
router.put("/invoices/:id",     requirePermission("lpg.invoices.issue"),    ctrl.updateInvoice);
router.delete("/invoices/:id",  requirePermission("lpg.invoices.issue"),    ctrl.deleteInvoice);

module.exports = router;
