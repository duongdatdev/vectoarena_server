import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import "../config/env";

if (!process.env.DATABASE_URL) {
    console.error("[prisma] Missing DATABASE_URL environment variable.");
    process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export { pool };
export default prisma;
