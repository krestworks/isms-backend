"use strict";
const prisma = require("../config/prisma");
const { resolveStation, canAccessStation } = require("../middleware/station");

// ── Departments ───────────────────────────────────────────────────────────────

async function listDepartments(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const where = stationId
      ? { OR: [{ stationId }, { stationId: "global" }] }
      : {};

    const departments = await prisma.department.findMany({
      where,
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { children: true, employees: true } },
      },
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
    });

    res.json({ success: true, data: departments });
  } catch (err) {
    next(err);
  }
}

async function createDepartment(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) {
      return res.status(422).json({ success: false, message: "Station context required" });
    }

    const { name, description, parentId } = req.body;

    if (parentId) {
      const parent = await prisma.department.findUnique({ where: { id: parentId } });
      if (!parent) return res.status(404).json({ success: false, message: "Parent department not found" });
      if (!await canAccessStation(req, parent.stationId)) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const dept = await prisma.department.create({
      data: { name: name.trim(), description: description?.trim(), stationId, parentId: parentId || null },
      include: { parent: { select: { id: true, name: true } } },
    });

    res.status(201).json({ success: true, message: "Department created", data: dept });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A department with this name already exists for this station" });
    }
    next(err);
  }
}

async function getDepartment(req, res, next) {
  try {
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id },
      include: {
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true } },
        jobTitles: { select: { id: true, title: true, grade: true } },
        _count: { select: { employees: true } },
      },
    });
    if (!dept) return res.status(404).json({ success: false, message: "Department not found" });

    if (!await canAccessStation(req, dept.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.json({ success: true, data: dept });
  } catch (err) {
    next(err);
  }
}

async function updateDepartment(req, res, next) {
  try {
    const { name, description, parentId } = req.body;
    const { id } = req.params;

    const dept = await prisma.department.findUnique({ where: { id } });
    if (!dept) return res.status(404).json({ success: false, message: "Department not found" });

    if (!await canAccessStation(req, dept.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (parentId && parentId === id) {
      return res.status(422).json({ success: false, message: "A department cannot be its own parent" });
    }

    const updated = await prisma.department.update({
      where: { id },
      data: {
        name: name ? name.trim() : undefined,
        description: description !== undefined ? description?.trim() : undefined,
        parentId: parentId !== undefined ? (parentId || null) : undefined,
      },
      include: { parent: { select: { id: true, name: true } } },
    });

    res.json({ success: true, message: "Department updated", data: updated });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A department with this name already exists for this station" });
    }
    next(err);
  }
}

async function deleteDepartment(req, res, next) {
  try {
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { children: true, employees: true } } },
    });
    if (!dept) return res.status(404).json({ success: false, message: "Department not found" });

    if (!await canAccessStation(req, dept.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (dept._count.children > 0 || dept._count.employees > 0) {
      return res.status(409).json({ success: false, message: "Cannot delete: department has sub-departments or employees" });
    }

    await prisma.department.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Department deleted" });
  } catch (err) {
    next(err);
  }
}

// ── Job Titles ────────────────────────────────────────────────────────────────

async function listJobTitles(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const { departmentId } = req.query;

    const where = {
      ...(departmentId ? { departmentId } : {}),
      ...(stationId ? { OR: [{ stationId }, { stationId: "global" }] } : {}),
    };

    const titles = await prisma.jobTitle.findMany({
      where,
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { employees: true } },
      },
      orderBy: { title: "asc" },
    });

    res.json({ success: true, data: titles });
  } catch (err) {
    next(err);
  }
}

async function createJobTitle(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    if (!stationId) {
      return res.status(422).json({ success: false, message: "Station context required" });
    }

    const { title, description, departmentId, grade } = req.body;

    if (departmentId) {
      const dept = await prisma.department.findUnique({ where: { id: departmentId } });
      if (!dept) return res.status(404).json({ success: false, message: "Department not found" });
      if (!await canAccessStation(req, dept.stationId)) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const jt = await prisma.jobTitle.create({
      data: { title: title.trim(), description: description?.trim(), departmentId: departmentId || null, stationId, grade: grade?.trim() },
      include: { department: { select: { id: true, name: true } } },
    });

    res.status(201).json({ success: true, message: "Job title created", data: jt });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A job title with this name already exists for this station" });
    }
    next(err);
  }
}

async function getJobTitle(req, res, next) {
  try {
    const jt = await prisma.jobTitle.findUnique({
      where: { id: req.params.id },
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { employees: true } },
      },
    });
    if (!jt) return res.status(404).json({ success: false, message: "Job title not found" });

    if (!await canAccessStation(req, jt.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.json({ success: true, data: jt });
  } catch (err) {
    next(err);
  }
}

async function updateJobTitle(req, res, next) {
  try {
    const jt = await prisma.jobTitle.findUnique({ where: { id: req.params.id } });
    if (!jt) return res.status(404).json({ success: false, message: "Job title not found" });

    if (!await canAccessStation(req, jt.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { title, description, departmentId, grade } = req.body;
    const updated = await prisma.jobTitle.update({
      where: { id: req.params.id },
      data: {
        title: title ? title.trim() : undefined,
        description: description !== undefined ? description?.trim() : undefined,
        departmentId: departmentId !== undefined ? (departmentId || null) : undefined,
        grade: grade !== undefined ? grade?.trim() : undefined,
      },
      include: { department: { select: { id: true, name: true } } },
    });

    res.json({ success: true, message: "Job title updated", data: updated });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A job title with this name already exists for this station" });
    }
    next(err);
  }
}

async function deleteJobTitle(req, res, next) {
  try {
    const jt = await prisma.jobTitle.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { employees: true } } },
    });
    if (!jt) return res.status(404).json({ success: false, message: "Job title not found" });

    if (!await canAccessStation(req, jt.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    if (jt._count.employees > 0) {
      return res.status(409).json({ success: false, message: "Cannot delete: job title is assigned to employees" });
    }

    await prisma.jobTitle.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Job title deleted" });
  } catch (err) {
    next(err);
  }
}

// ── Org chart ─────────────────────────────────────────────────────────────────

async function getOrgChart(req, res, next) {
  try {
    const stationId = await resolveStation(req);

    async function buildTree(parentId) {
      const filter = {
        parentId,
        ...(stationId ? { OR: [{ stationId }, { stationId: "global" }] } : {}),
      };
      const nodes = await prisma.department.findMany({
        where: filter,
        include: {
          jobTitles: { select: { id: true, title: true, grade: true } },
          _count: { select: { employees: true } },
        },
        orderBy: { name: "asc" },
      });
      return Promise.all(nodes.map(async n => ({ ...n, children: await buildTree(n.id) })));
    }

    const tree = await buildTree(null);
    res.json({ success: true, data: tree });
  } catch (err) {
    next(err);
  }
}

// ── Station Modules ───────────────────────────────────────────────────────────

const ALL_MODULES = ["hr", "fuel", "lpg", "water", "carwash", "auto", "pos", "finance", "compliance"];

async function getStationModules(req, res, next) {
  try {
    const { stationId } = req.params;

    if (!await canAccessStation(req, stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const station = await prisma.station.findUnique({ where: { id: stationId } });
    if (!station) return res.status(404).json({ success: false, message: "Station not found" });

    const existing = await prisma.stationModule.findMany({ where: { stationId } });
    const moduleMap = Object.fromEntries(existing.map(m => [m.module, m]));

    const data = ALL_MODULES.map(mod => ({
      module: mod,
      isEnabled: moduleMap[mod]?.isEnabled ?? mod === "hr",
      updatedAt: moduleMap[mod]?.updatedAt ?? null,
    }));

    res.json({ success: true, stationId, stationName: station.name, data });
  } catch (err) {
    next(err);
  }
}

async function updateStationModules(req, res, next) {
  try {
    const { stationId } = req.params;

    if (!await canAccessStation(req, stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const station = await prisma.station.findUnique({ where: { id: stationId } });
    if (!station) return res.status(404).json({ success: false, message: "Station not found" });

    const { modules } = req.body;
    if (!modules || typeof modules !== "object") {
      return res.status(422).json({ success: false, message: "modules must be an object mapping module names to booleans" });
    }

    const invalidKeys = Object.keys(modules).filter(k => !ALL_MODULES.includes(k));
    if (invalidKeys.length > 0) {
      return res.status(422).json({ success: false, message: `Unknown modules: ${invalidKeys.join(", ")}` });
    }
    if (modules.hr === false) {
      return res.status(422).json({ success: false, message: "The HR module cannot be disabled" });
    }

    for (const [mod, isEnabled] of Object.entries(modules)) {
      await prisma.stationModule.upsert({
        where: { stationId_module: { stationId, module: mod } },
        update: { isEnabled: Boolean(isEnabled) },
        create: { stationId, module: mod, isEnabled: Boolean(isEnabled) },
      });
    }

    return getStationModules(req, res, next);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listDepartments, createDepartment, getDepartment, updateDepartment, deleteDepartment,
  listJobTitles, createJobTitle, getJobTitle, updateJobTitle, deleteJobTitle,
  getOrgChart,
  getStationModules, updateStationModules,
};
