"use strict";
require("dotenv").config();

const config = {
  port: parseInt(process.env.PORT || "5000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:8080",

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },

  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || "12", 10),

  at: {
    apiKey:   process.env.AT_API_KEY   || "",
    username: process.env.AT_USERNAME  || "sandbox",
    senderId: process.env.AT_SENDER_ID || "",
  },

  get isProd() { return this.nodeEnv === "production"; },
  get isDev()  { return this.nodeEnv === "development"; },
};

function validateConfig() {
  const required = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

module.exports = { config, validateConfig };
