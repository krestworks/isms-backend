"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const c = require("../controllers/settingsController");

const router = Router();
router.use(authenticate);

// Station config (business details, vat global config, etc.)
router.get("/config/:section",  c.getConfig);
router.put("/config/:section",  c.setConfig);

// VAT rate schedule
router.get("/vat-rates",        c.listVatRates);
router.post("/vat-rates",       c.createVatRate);
router.put("/vat-rates/:id",    c.updateVatRate);
router.delete("/vat-rates/:id", c.deleteVatRate);

module.exports = router;
