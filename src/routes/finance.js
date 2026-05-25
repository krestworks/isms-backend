"use strict";
const { Router } = require("express");
const { authenticate } = require("../middleware/auth");
const c = require("../controllers/financeController");

const router = Router();
router.use(authenticate);

// Revenue
router.get("/revenue",        c.listRevenue);
router.post("/revenue",       c.createRevenue);
router.put("/revenue/:id",    c.updateRevenue);
router.delete("/revenue/:id", c.deleteRevenue);

// Expenses
router.get("/expenses",        c.listExpenses);
router.post("/expenses",       c.createExpense);
router.put("/expenses/:id",    c.updateExpense);
router.delete("/expenses/:id", c.deleteExpense);

// P&L aggregation
router.get("/pl", c.getProfitLoss);

// Budget
router.get("/budgets",        c.listBudgets);
router.post("/budgets",       c.upsertBudget);
router.delete("/budgets/:id", c.deleteBudget);

// Budget vs Actual variance
router.get("/variance", c.getVariance);

module.exports = router;
