"use strict";
const prisma = require("../config/prisma");
const { resolveStation, canAccessStation } = require("../middleware/station");

const EMPLOYEE_SELECT = {
  id: true,
  employeeNumber: true,
  user: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
};

// ── GET /hr/performance ───────────────────────────────────────────────────────

async function listTasks(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const { employeeId, status, category, page = "1", limit = "50" } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));

    const where = {};
    if (stationId)  where.stationId  = stationId;
    if (employeeId) where.employeeId = employeeId;
    if (status)     where.status     = status;
    if (category)   where.category   = category;

    const [tasks, total] = await prisma.$transaction([
      prisma.performanceTask.findMany({
        where,
        include: { employee: { select: EMPLOYEE_SELECT } },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.performanceTask.count({ where }),
    ]);

    res.json({ success: true, data: tasks, meta: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } });
  } catch (err) {
    next(err);
  }
}

// ── POST /hr/performance ──────────────────────────────────────────────────────

async function createTask(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const { employeeId, title, category = "General", dueDate, status = "todo", priority = "medium", notes, rating, assignedBy } = req.body;

    if (!employeeId) return res.status(422).json({ success: false, message: "employeeId is required" });
    if (!title)      return res.status(422).json({ success: false, message: "title is required" });

    const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });
    if (!await canAccessStation(req, emp.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const task = await prisma.performanceTask.create({
      data: {
        stationId: stationId || emp.stationId,
        employeeId,
        title,
        category,
        dueDate:    dueDate    || null,
        status,
        priority,
        notes:      notes      || null,
        rating:     rating     !== undefined ? parseInt(rating) : null,
        assignedBy: assignedBy || req.user.sub,
      },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });

    res.status(201).json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

// ── PUT /hr/performance/:id ───────────────────────────────────────────────────

async function updateTask(req, res, next) {
  try {
    const { id } = req.params;
    const task = await prisma.performanceTask.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    if (!await canAccessStation(req, task.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { title, category, dueDate, status, priority, notes, rating } = req.body;
    const data = {};
    if (title    !== undefined) data.title    = title;
    if (category !== undefined) data.category = category;
    if (dueDate  !== undefined) data.dueDate  = dueDate || null;
    if (status   !== undefined) {
      data.status = status;
      if (status === "done" && !task.completedAt) data.completedAt = new Date();
      if (status !== "done") data.completedAt = null;
    }
    if (priority !== undefined) data.priority = priority;
    if (notes    !== undefined) data.notes    = notes;
    if (rating   !== undefined) data.rating   = rating !== null ? parseInt(rating) : null;

    const updated = await prisma.performanceTask.update({
      where: { id },
      data,
      include: { employee: { select: EMPLOYEE_SELECT } },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /hr/performance/:id ────────────────────────────────────────────────

async function deleteTask(req, res, next) {
  try {
    const { id } = req.params;
    const task = await prisma.performanceTask.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });
    if (!await canAccessStation(req, task.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    await prisma.performanceTask.delete({ where: { id } });
    res.json({ success: true, data: { id } });
  } catch (err) {
    next(err);
  }
}

module.exports = { listTasks, createTask, updateTask, deleteTask };
