import prisma from "../src/database/prisma";

async function main() {
  console.log("[Seed] Gameplay balance is loaded from config/gameplay/default.json");
  console.log("[Seed] No database config tables are required for the current schema.");
}

async function runSeed() {
  try {
    await main();
  } catch (error) {
    console.error("[Seed] Failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void runSeed();
