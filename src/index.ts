import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { BattleRoom } from "./rooms/BattleRoom";
import authRoutes from "./routes/auth";
import playerRoutes from "./routes/player";

const port = Number(process.env.PORT || 2567);
const app = express();

app.use(cors());
app.use(express.json());

//auth routes
app.use("/auth", authRoutes);
app.use("/player", playerRoutes);

const httpServer = createServer(app);
const gameServer = new Server({
    transport: new WebSocketTransport({
        server: httpServer
    })
});

gameServer.define("battle", BattleRoom);

gameServer.listen(port)
    .then(() => console.log(`[GameServer] Listening on Port: ${port}`))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
