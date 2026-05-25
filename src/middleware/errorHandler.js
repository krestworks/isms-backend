"use strict";
const { config } = require("../config/env");

function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  if (config.isDev) console.error(err.stack);

  if (err.name === "PrismaClientKnownRequestError") {
    if (err.code === "P2002") {
      return res.status(409).json({ success: false, message: "A record with that value already exists" });
    }
    return res.status(400).json({ success: false, message: "Database request error" });
  }

  if (err.name === "PrismaClientValidationError") {
    return res.status(400).json({ success: false, message: "Invalid data provided" });
  }

  const status = err.status || err.statusCode || 500;
  const message = status < 500 ? err.message : "Internal server error";

  res.status(status).json({ success: false, message });
}

function notFound(req, res) {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
}

module.exports = { errorHandler, notFound };
