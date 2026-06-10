"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const c = require("../controllers/clientsController");

const router = Router();
router.use(authenticate);

// Clients
router.get("/clients",        c.listClients);
router.post("/clients",       c.createClient);
router.put("/clients/:id",    c.updateClient);
router.delete("/clients/:id", c.deleteClient);

// Coupons
router.get("/coupons",        c.listCoupons);
router.post("/coupons",       c.createCoupon);
router.put("/coupons/:id",    c.updateCoupon);
router.delete("/coupons/:id", c.deleteCoupon);

// Client Orders
router.get("/orders",         c.listOrders);
router.post("/orders",        c.createOrder);
router.put("/orders/:id",     c.updateOrder);
router.delete("/orders/:id",  c.deleteOrder);

module.exports = router;
