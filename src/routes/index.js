"use strict";
const { Router } = require("express");
const authRoutes        = require("./auth");
const usersRoutes       = require("./users");
const permissionsRoutes = require("./permissions");
const stationsRoutes    = require("./stations");
const hrRoutes          = require("./hr");
const fuelRoutes        = require("./fuel");
const lpgRoutes         = require("./lpg");
const waterRoutes       = require("./water");
const autoRoutes        = require("./auto");
const carwashRoutes     = require("./carwash");
const bizRoutes         = require("./biz");
const clientsRoutes     = require("./clients");
const financeRoutes     = require("./finance");
const settingsRoutes    = require("./settings");
const reportsRoutes     = require("./reports");

const router = Router();

router.use("/auth",        authRoutes);
router.use("/users",       usersRoutes);
router.use("/permissions", permissionsRoutes);
router.use("/stations",    stationsRoutes);
router.use("/hr",          hrRoutes);
router.use("/fuel",        fuelRoutes);
router.use("/lpg",         lpgRoutes);
router.use("/water",       waterRoutes);
router.use("/auto",        autoRoutes);
router.use("/carwash",     carwashRoutes);
router.use("/biz",         bizRoutes);
router.use("/crm",         clientsRoutes);
router.use("/finance",     financeRoutes);
router.use("/settings",    settingsRoutes);
router.use("/reports",     reportsRoutes);

// Health check
router.get("/health", (_req, res) => {
  res.json({ success: true, status: "ok", timestamp: new Date().toISOString() });
});

module.exports = router;
