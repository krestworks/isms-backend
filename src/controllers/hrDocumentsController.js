"use strict";
const prisma = require("../config/prisma");
const { resolveStation, canAccessStation } = require("../middleware/station");

async function listDocuments(req, res, next) {
  try {
    const stationId = await resolveStation(req);
    const { employeeId, type, status, caseId } = req.query;

    const where = {};
    if (employeeId) {
      where.employeeId = employeeId;
    } else if (stationId) {
      where.employee = { stationId };
    }
    if (type)   where.type   = type;
    if (status) where.status = status;
    if (caseId) where.caseId = caseId;

    const docs = await prisma.employeeDocument.findMany({
      where,
      select: {
        id: true, employeeId: true, type: true, fileName: true, fileSize: true,
        expiresOn: true, status: true, notes: true, caseId: true,
        uploadedBy: true, uploadedAt: true,
        employee: { select: { id: true, employeeNumber: true, user: { select: { name: true } } } },
      },
      orderBy: { uploadedAt: "desc" },
    });

    res.json({ success: true, data: docs });
  } catch (err) { next(err); }
}

async function getDocument(req, res, next) {
  try {
    const doc = await prisma.employeeDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });

    if (!await canAccessStation(req, doc.employee?.stationId)) {
      const emp = await prisma.employee.findUnique({ where: { id: doc.employeeId } });
      if (emp && !await canAccessStation(req, emp.stationId)) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
}

async function createDocument(req, res, next) {
  try {
    const { employeeId, type, fileName, fileSize, fileData, expiresOn, status, notes, caseId } = req.body;

    if (!employeeId) return res.status(422).json({ success: false, message: "employeeId is required" });
    if (!fileName)   return res.status(422).json({ success: false, message: "fileName is required" });
    if (!type)       return res.status(422).json({ success: false, message: "type is required" });

    const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    if (!await canAccessStation(req, emp.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const doc = await prisma.employeeDocument.create({
      data: {
        employeeId,
        type,
        fileName,
        fileSize: fileSize ? parseInt(fileSize, 10) : 0,
        fileData: fileData || null,
        expiresOn: expiresOn || null,
        status: status || "valid",
        notes: notes || null,
        caseId: caseId || null,
        uploadedBy: req.user?.email || "System",
      },
      select: {
        id: true, employeeId: true, type: true, fileName: true, fileSize: true,
        expiresOn: true, status: true, notes: true, caseId: true,
        uploadedBy: true, uploadedAt: true,
        employee: { select: { id: true, employeeNumber: true, user: { select: { name: true } } } },
      },
    });

    res.status(201).json({ success: true, message: "Document uploaded", data: doc });
  } catch (err) { next(err); }
}

async function updateDocument(req, res, next) {
  try {
    const doc = await prisma.employeeDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });

    const emp = await prisma.employee.findUnique({ where: { id: doc.employeeId } });
    if (emp && !await canAccessStation(req, emp.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { type, fileName, fileSize, fileData, expiresOn, status, notes, caseId } = req.body;

    const updated = await prisma.employeeDocument.update({
      where: { id: req.params.id },
      data: {
        type:      type      !== undefined ? type      : undefined,
        fileName:  fileName  !== undefined ? fileName  : undefined,
        fileSize:  fileSize  !== undefined ? parseInt(fileSize, 10) : undefined,
        fileData:  fileData  !== undefined ? fileData  : undefined,
        expiresOn: expiresOn !== undefined ? (expiresOn || null) : undefined,
        status:    status    !== undefined ? status    : undefined,
        notes:     notes     !== undefined ? (notes || null) : undefined,
        caseId:    caseId    !== undefined ? (caseId || null) : undefined,
      },
      select: {
        id: true, employeeId: true, type: true, fileName: true, fileSize: true,
        expiresOn: true, status: true, notes: true, caseId: true,
        uploadedBy: true, uploadedAt: true,
        employee: { select: { id: true, employeeNumber: true, user: { select: { name: true } } } },
      },
    });

    res.json({ success: true, message: "Document updated", data: updated });
  } catch (err) { next(err); }
}

async function deleteDocument(req, res, next) {
  try {
    const doc = await prisma.employeeDocument.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });

    const emp = await prisma.employee.findUnique({ where: { id: doc.employeeId } });
    if (emp && !await canAccessStation(req, emp.stationId)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    await prisma.employeeDocument.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Document deleted" });
  } catch (err) { next(err); }
}

async function downloadDocument(req, res, next) {
  try {
    const doc = await prisma.employeeDocument.findUnique({
      where: { id: req.params.id },
      select: { id: true, employeeId: true, fileName: true, fileData: true },
    });
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
    if (!doc.fileData) return res.status(404).json({ success: false, message: "No file stored for this document" });

    res.json({ success: true, data: { fileName: doc.fileName, fileData: doc.fileData } });
  } catch (err) { next(err); }
}

module.exports = { listDocuments, getDocument, createDocument, updateDocument, deleteDocument, downloadDocument };
