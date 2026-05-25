"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const c = require("../controllers/reportsController");

const router = Router();
router.use(authenticate);

// Templates
router.get("/templates",        c.listTemplates);
router.post("/templates",       c.createTemplate);
router.put("/templates/:id",    c.updateTemplate);
router.delete("/templates/:id", c.deleteTemplate);

// Generated reports (also serves as export history when format != null)
router.get("/generated",        c.listReports);
router.post("/generated",       c.createReport);
router.put("/generated/:id",    c.updateReport);
router.delete("/generated/:id", c.deleteReport);

// Scheduled reports
router.get("/scheduled",        c.listScheduled);
router.post("/scheduled",       c.createScheduled);
router.put("/scheduled/:id",    c.updateScheduled);
router.delete("/scheduled/:id", c.deleteScheduled);

module.exports = router;
