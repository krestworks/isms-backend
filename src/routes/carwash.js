"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const c = require("../controllers/carwashController");

const router = Router();
router.use(authenticate);

router.get("/sales",       c.listSales);
router.post("/sales",      c.createSale);
router.put("/sales/:id",   c.updateSale);
router.delete("/sales/:id",c.deleteSale);

router.get("/bookings",       c.listBookings);
router.post("/bookings",      c.createBooking);
router.put("/bookings/:id",   c.updateBooking);
router.delete("/bookings/:id",c.deleteBooking);

router.get("/staff",       c.listStaff);
router.post("/staff",      c.createStaff);
router.put("/staff/:id",   c.updateStaff);
router.delete("/staff/:id",c.deleteStaff);

router.get("/queue",       c.listQueue);
router.post("/queue",      c.createQueue);
router.put("/queue/:id",   c.updateQueue);
router.delete("/queue/:id",c.deleteQueue);

router.get("/packages",       c.listPackages);
router.post("/packages",      c.createPackage);
router.put("/packages/:id",   c.updatePackage);
router.delete("/packages/:id",c.deletePackage);

module.exports = router;
