import { Router, Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { Prisma } from "@prisma/client";
import prisma from "../database/prisma";
import { DEFAULT_PLAYER_SKIN_ID } from "../managers/SkinCatalog";
import { JWT_SECRET, JWT_EXPIRES_IN } from "../config/env";

const router = Router();

const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again in a minute." },
});

const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 32;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 128;
const USERNAME_REGEX = /^[a-zA-Z0-9_.-]+$/;

function validateCredentials(username?: unknown, password?: unknown): string | null {
    if (typeof username !== "string" || typeof password !== "string") {
        return "Username and password are required.";
    }
    if (username.length < MIN_USERNAME_LEN || username.length > MAX_USERNAME_LEN) {
        return `Username must be ${MIN_USERNAME_LEN}-${MAX_USERNAME_LEN} characters.`;
    }
    if (!USERNAME_REGEX.test(username)) {
        return "Username can only contain letters, numbers, dot, dash and underscore.";
    }
    if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
        return `Password must be ${MIN_PASSWORD_LEN}-${MAX_PASSWORD_LEN} characters.`;
    }
    return null;
}

router.post("/register", authLimiter, async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: unknown; password?: unknown };

    const validationError = validateCredentials(username, password);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    try {
        const hashedPassword = await bcrypt.hash(password as string, BCRYPT_COST);
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

router.post("/login", authLimiter, async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: unknown; password?: unknown };

    const validationError = validateCredentials(username, password);
    if (validationError) {
        return res.status(400).json({ error: validationError });
    }

    try {
        const user = await (prisma as any).user.findUnique({
            where: { username: username as string }
        });

        if (!user) {
            return res.status(401).json({ error: "Invalid username or password." });
        }

        if (user.bannedAt) {
            return res.status(403).json({
                error: "Your account has been banned.",
                code: "ACCOUNT_BANNED",
                reason: user.banReason || "No reason provided."
            });
        }

        const isValid = await bcrypt.compare(password as string, user.password);
        if (!isValid) {
            return res.status(401).json({ error: "Invalid username or password." });
        }

        const token = jwt.sign({ userId: user.id, username: user.username, role: user.role }, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN as any
        });

        return res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Unable to login." });
    }
});

export default router;
