"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const { requirePermission } = require("../middleware/authorize");
const {
  listTanks, createTank, updateTank, deleteTank, recordDip,
  listSales, createSale, updateSale, voidSale,
  listDeliveries, createDelivery,
  listReconciliations, createReconciliation, approveReconciliation,
  listProducts, upsertProduct, deleteProduct,
  getSummary,
} = require("../controllers/fuelController");

const router = Router();
router.use(authenticate);

// ── Summary ───────────────────────────────────────────────────────────────────
router.get("/summary",    requirePermission("fuel.sales.view"),          getSummary);

// ── Tanks ─────────────────────────────────────────────────────────────────────
router.get(   "/tanks",           requirePermission("fuel.tanks.view"),    listTanks);
router.post(  "/tanks",           requirePermission("fuel.tanks.create"),  createTank);
router.put(   "/tanks/:id",       requirePermission("fuel.tanks.edit"),    updateTank);
router.delete("/tanks/:id",       requirePermission("fuel.tanks.edit"),    deleteTank);
router.post(  "/tanks/:id/dip",   requirePermission("fuel.dips.record"),   recordDip);

// ── Sales ─────────────────────────────────────────────────────────────────────
router.get(   "/sales",           requirePermission("fuel.sales.view"),    listSales);
router.post(  "/sales",           requirePermission("fuel.sales.record"),  createSale);
router.put(   "/sales/:id",       requirePermission("fuel.sales.record"),  updateSale);
router.delete("/sales/:id",       requirePermission("fuel.sales.void"),    voidSale);

// ── Deliveries ────────────────────────────────────────────────────────────────
router.get(   "/deliveries",      requirePermission("fuel.deliveries.view"),   listDeliveries);
router.post(  "/deliveries",      requirePermission("fuel.inventory.receive"), createDelivery);

// ── Reconciliations ───────────────────────────────────────────────────────────
router.get(   "/reconciliations",          requirePermission("fuel.reconciliation.view"),    listReconciliations);
router.post(  "/reconciliations",          requirePermission("fuel.sales.record"),           createReconciliation);
router.post(  "/reconciliations/:id/approve", requirePermission("fuel.reconciliation.approve"), approveReconciliation);

// ── Products (pricing config) ─────────────────────────────────────────────────
router.get(   "/products",        requirePermission("fuel.sales.view"),    listProducts);
router.put(   "/products",        requirePermission("fuel.tanks.edit"),    upsertProduct);
router.delete("/products/:id",    requirePermission("fuel.tanks.edit"),    deleteProduct);

module.exports = router;
