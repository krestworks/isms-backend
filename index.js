"use strict";
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { validateConfig } = require("./src/config/env");
const { config } = require("./src/config/env");
const app = require("./src/server");

const prisma = new PrismaClient();

async function main() {
  validateConfig();

  await prisma.$connect();
  console.log("[DB] Connected to database");

  app.listen(config.port, () => {
    console.log(`[API] ISMS backend running on http://localhost:${config.port}`);
    console.log(`[API] Environment: ${config.nodeEnv}`);
  });
}

main().catch(err => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
