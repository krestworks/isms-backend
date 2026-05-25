"use strict";
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { config } = require("../config/env");

function generateAccessToken(payload) {
  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
    issuer: "isms-api",
  });
}

function generateRefreshToken(payload) {
  // jti (JWT ID) ensures every token is unique even when issued within the same second
  return jwt.sign(
    { ...payload, jti: crypto.randomBytes(16).toString("hex") },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn, issuer: "isms-api" },
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret, { issuer: "isms-api" });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret, { issuer: "isms-api" });
}

function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateResetToken,
  hashResetToken,
};
