const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const ctrl = require("../controllers/waterController");

router.use(authenticate);

// Summary
router.get("/summary", requirePermission("water.production.view"), ctrl.getSummary);

// Production
router.get("/production",       requirePermission("water.production.view"),    ctrl.listProduction);
router.post("/production",      requirePermission("water.production.log"),      ctrl.createProduction);
router.put("/production/:id",   requirePermission("water.production.log"),      ctrl.updateProduction);
router.delete("/production/:id", requirePermission("water.production.log"),     ctrl.deleteProduction);

// Equipment
router.get("/equipment",        requirePermission("water.equipment.view"),      ctrl.listEquipment);
router.post("/equipment",       requirePermission("water.equipment.manage"),    ctrl.createEquipment);
router.put("/equipment/:id",    requirePermission("water.equipment.manage"),    ctrl.updateEquipment);
router.delete("/equipment/:id", requirePermission("water.equipment.manage"),    ctrl.deleteEquipment);

// Sales
router.get("/sales",            requirePermission("water.production.view"),     ctrl.listSales);
router.post("/sales",           requirePermission("water.sales.record"),        ctrl.createSale);
router.put("/sales/:id",        requirePermission("water.sales.record"),        ctrl.updateSale);
router.delete("/sales/:id",     requirePermission("water.sales.record"),        ctrl.voidSale);

// Orders
router.get("/orders",           requirePermission("water.production.view"),     ctrl.listOrders);
router.post("/orders",          requirePermission("water.orders.create"),       ctrl.createOrder);
router.put("/orders/:id",       requirePermission("water.orders.create"),       ctrl.updateOrder);
router.delete("/orders/:id",    requirePermission("water.orders.create"),       ctrl.deleteOrder);

// Distribution
router.get("/distribution",       requirePermission("water.production.view"),       ctrl.listDistribution);
router.post("/distribution",      requirePermission("water.distributions.deliver"), ctrl.createDistribution);
router.put("/distribution/:id",   requirePermission("water.distributions.deliver"), ctrl.updateDistribution);
router.delete("/distribution/:id", requirePermission("water.distributions.deliver"), ctrl.deleteDistribution);

// Invoices
router.get("/invoices",         requirePermission("water.production.view"),     ctrl.listInvoices);
router.post("/invoices",        requirePermission("water.invoices.issue"),      ctrl.createInvoice);
router.put("/invoices/:id",     requirePermission("water.invoices.issue"),      ctrl.updateInvoice);
router.delete("/invoices/:id",  requirePermission("water.invoices.issue"),      ctrl.deleteInvoice);

module.exports = router;
