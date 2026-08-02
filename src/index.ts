import "./config/env";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { BattleRoom } from "./rooms/BattleRoom";
import authRoutes from "./routes/auth";
import playerRoutes from "./routes/player";
import web3Routes from "./routes/web3Routes";
import walletRoutes from "./routes/wallet";
import nftRoutes from "./routes/nft";
import antiCheatRoutes from "./routes/anticheat";
import adminRoutes from "./routes/admin";
import prisma, { pool } from "./database/prisma";
import { ALLOWED_ORIGINS } from "./config/env";

const port = Number(process.env.PORT || 2567);
const app = express();

const corsOptions: cors.CorsOptions = ALLOWED_ORIGINS.length > 0
    ? {
        origin: (origin, callback) => {
            if (!origin || ALLOWED_ORIGINS.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error(`CORS: origin ${origin} not allowed`));
        },
        credentials: false,
    }
    : {};

app.use(cors(corsOptions));
app.use(express.json({ limit: "32kb" }));

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

//auth routes
app.use("/auth", authRoutes);
app.use("/player", playerRoutes);
app.use("/web3", web3Routes);
app.use("/wallet", walletRoutes);
app.use("/nft", nftRoutes);
app.use("/admin/anticheat", antiCheatRoutes);
app.use("/admin", adminRoutes);

const httpServer = createServer(app);
const gameServer = new Server({
    transport: new WebSocketTransport({
        server: httpServer
    })
});

gameServer.define("battle", BattleRoom);
gameServer.define("airdrop", BattleRoom, { mode: "airdrop" });

gameServer.listen(port)
    .then(() => console.log(`[GameServer] Listening on Port: ${port}`))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[GameServer] Received ${signal}, shutting down gracefully...`);

    const shutdownTimeout = setTimeout(() => {
        console.error("[GameServer] Graceful shutdown timed out. Forcing exit.");
        process.exit(1);
    }, 30_000);
    shutdownTimeout.unref();

    try {
        await gameServer.gracefullyShutdown(false);
    } catch (err) {
        console.error("[GameServer] Error during gameServer.gracefullyShutdown:", err);
    }
    try {
        await prisma.$disconnect();
    } catch (err) {
        console.error("[GameServer] Error during prisma.$disconnect:", err);
    }
    try {
        await pool.end();
    } catch (err) {
        console.error("[GameServer] Error during pg pool.end:", err);
    }
    clearTimeout(shutdownTimeout);
    console.log("[GameServer] Shutdown complete.");
    process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });

process.on("unhandledRejection", (reason) => {
    console.error("[UnhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
    console.error("[UncaughtException]", err);
    void shutdown("uncaughtException");
});
