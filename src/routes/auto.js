"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const c = require("../controllers/autoController");

const router = Router();
router.use(authenticate);

router.get("/service-records",       c.listServiceRecords);
router.post("/service-records",      c.createServiceRecord);
router.put("/service-records/:id",   c.updateServiceRecord);
router.delete("/service-records/:id",c.deleteServiceRecord);

router.get("/bills",       c.listBills);
router.post("/bills",      c.createBill);
router.put("/bills/:id",   c.updateBill);
router.delete("/bills/:id",c.deleteBill);

router.get("/invoices",       c.listInvoices);
router.post("/invoices",      c.createInvoice);
router.put("/invoices/:id",   c.updateInvoice);
router.delete("/invoices/:id",c.deleteInvoice);

router.get("/parts",       c.listParts);
router.post("/parts",      c.createPart);
router.put("/parts/:id",   c.updatePart);
router.delete("/parts/:id",c.deletePart);

router.get("/pricing",       c.listPricing);
router.post("/pricing",      c.createPricing);
router.put("/pricing/:id",   c.updatePricing);
router.delete("/pricing/:id",c.deletePricing);

router.get("/technicians",       c.listTechnicians);
router.post("/technicians",      c.createTechnician);
router.put("/technicians/:id",   c.updateTechnician);
router.delete("/technicians/:id",c.deleteTechnician);

module.exports = router;
