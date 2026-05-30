import { Router, Response } from "express";
import prisma from "../database/prisma";
import { AuthenticatedRequest, authenticateToken } from "../middleware/auth";

const router = Router();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(value: unknown): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

router.get("/assessments", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const limit = parseLimit(req.query.limit);
  const label = Array.isArray(req.query.label) ? req.query.label[0] : req.query.label;
  const where: any = {};

  if (label === "Normal" || label === "Suspicious") {
    where.label = label;
  }

  try {
    const assessments = await (prisma as any).antiCheatAssessment.findMany({
      where,
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        score: true,
        label: true,
        modelVersion: true,
        reasonCodes: true,
        createdAt: true,
        participant: {
          select: {
            id: true,
            userId: true,
            usernameSnapshot: true,
            sessionId: true,
            kills: true,
            deaths: true,
            damageDealt: true,
            damageTaken: true,
            placement: true,
            survivedSeconds: true,
            match: {
              select: {
                id: true,
                roomCode: true,
                mode: true,
                durationSeconds: true,
                endedAt: true,
              },
            },
            antiCheatTelemetry: true,
          },
        },
      },
    });

    return res.json({ assessments, limit });
  } catch (error) {
    console.error("[AntiCheatRoute] Failed to load assessments:", error);
    return res.status(500).json({ error: "Unable to load anti-cheat assessments." });
  }
});

router.get("/telemetry", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const limit = parseLimit(req.query.limit);

  try {
    const telemetry = await (prisma as any).antiCheatTelemetry.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        participant: {
          select: {
            id: true,
            userId: true,
            usernameSnapshot: true,
            sessionId: true,
            kills: true,
            deaths: true,
            damageDealt: true,
            damageTaken: true,
            placement: true,
            survivedSeconds: true,
            match: {
              select: {
                id: true,
                roomCode: true,
                mode: true,
                durationSeconds: true,
                endedAt: true,
              },
            },
          },
        },
      },
    });

    return res.json({ telemetry, limit });
  } catch (error) {
    console.error("[AntiCheatRoute] Failed to load telemetry:", error);
    return res.status(500).json({ error: "Unable to load anti-cheat telemetry." });
  }
});

router.get("/players/:userId", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const assessments = await (prisma as any).antiCheatAssessment.findMany({
      where: {
        participant: {
          userId: req.params.userId,
        },
      },
      orderBy: { createdAt: "desc" },
      take: parseLimit(req.query.limit),
      include: {
        participant: {
          include: {
            match: true,
            antiCheatTelemetry: true,
          },
        },
      },
    });

    return res.json({ userId: req.params.userId, assessments });
  } catch (error) {
    console.error("[AntiCheatRoute] Failed to load player assessments:", error);
    return res.status(500).json({ error: "Unable to load player anti-cheat assessments." });
  }
});

export default router;
