import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import dotenv from "dotenv";
import prisma from "../database/prisma";
import { DEFAULT_PLAYER_SKIN_ID } from "../managers/SkinCatalog";

dotenv.config();

const router = Router();

const jwtSecret = process.env.JWT_SECRET || "supersecretkey";

router.post("/register", async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required." });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await (prisma as any).user.create({
            data: {
                username,
                password: hashedPassword,
                loadout: {
                    create: {
                        equippedPlayerSkin: DEFAULT_PLAYER_SKIN_ID
                    }
                },
                skinInventory: {
                    create: {
                        skinCode: DEFAULT_PLAYER_SKIN_ID,
                        skinType: "PLAYER",
                        source: "SHOP"
                    }
                }
            }
        });

        return res.status(201).json({ id: user.id, username: user.username });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return res.status(409).json({ error: "Username already exists." });
        }
        console.error(error);
        return res.status(500).json({ error: "Unable to register user." });
    }
});

router.post("/login", async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required." });
    }

    try {
        const user = await (prisma as any).user.findUnique({
            where: { username }
        });

        if (!user) {
            return res.status(401).json({ error: "Invalid username or password." });
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(401).json({ error: "Invalid username or password." });
        }

        const token = jwt.sign({ userId: user.id, username: user.username }, jwtSecret, {
            expiresIn: "2h"
        });

        return res.json({ token });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Unable to login." });
    }
});

export default router;