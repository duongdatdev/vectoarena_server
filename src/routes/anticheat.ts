import { Router, Response } from "express";
import prisma from "../database/prisma";
import { requireAdmin } from "../middleware/admin";
import { AuthenticatedRequest, authenticateToken } from "../middleware/auth";

const router = Router();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ASSESSMENT_LABELS = new Set(["Normal", "Review", "Suspicious"]);
const REVIEW_STATUSES = new Set(["Confirmed", "FalsePositive", "Ignored"]);

router.use(authenticateToken, requireAdmin);

function parseLimit(value: unknown): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

router.get("/assessments", async (req: AuthenticatedRequest, res: Response) => {
  const limit = parseLimit(req.query.limit);
  const label = Array.isArray(req.query.label) ? req.query.label[0] : req.query.label;

  try {
    const telemetryRows = await (prisma as any).antiCheatTelemetry.findMany({
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
            user: {
              select: {
                bannedAt: true,
                banReason: true,
              },
            },
            match: {
              select: {
                id: true,
                roomCode: true,
                mode: true,
                durationSeconds: true,
                endedAt: true,
              },
            },
            antiCheatAssessments: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                score: true,
                label: true,
                modelVersion: true,
                reasonCodes: true,
                reviewedAt: true,
                reviewStatus: true,
                reviewerNote: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    const assessments = telemetryRows.map((telemetry: any) => {
      const assessment = telemetry.participant.antiCheatAssessments[0] ?? null;
      const { antiCheatAssessments, ...participant } = telemetry.participant;

      return {
        id: assessment?.id ?? null,
        telemetryId: telemetry.id,
        score: assessment?.score ?? 0,
        label: assessment?.label ?? "Normal",
        modelVersion: assessment?.modelVersion ?? "telemetry-only",
        reasonCodes: assessment?.reasonCodes ?? [],
        reviewedAt: assessment?.reviewedAt ?? null,
        reviewStatus: assessment?.reviewStatus ?? null,
        reviewerNote: assessment?.reviewerNote ?? null,
        createdAt: assessment?.createdAt ?? telemetry.createdAt,
        participant: {
          ...participant,
          antiCheatTelemetry: telemetry,
        },
      };
    }).filter((assessment: any) => {
      return !(typeof label === "string" && ASSESSMENT_LABELS.has(label)) || assessment.label === label;
    });

    return res.json({ assessments, limit });
  } catch (error) {
    console.error("[AntiCheatRoute] Failed to load assessments:", error);
    return res.status(500).json({ error: "Unable to load anti-cheat assessments." });
  }
});

router.get("/flagged-assessments", async (req: AuthenticatedRequest, res: Response) => {
  const limit = parseLimit(req.query.limit);
  const label = Array.isArray(req.query.label) ? req.query.label[0] : req.query.label;
  const where: any = {};

  if (typeof label === "string" && ASSESSMENT_LABELS.has(label)) {
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
        reviewedAt: true,
        reviewStatus: true,
        reviewerNote: true,
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
            user: {
              select: {
                bannedAt: true,
                banReason: true,
              },
            },
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

router.get("/telemetry", async (req: AuthenticatedRequest, res: Response) => {
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

router.patch("/assessments/:id/review", async (req: AuthenticatedRequest, res: Response) => {
  const { reviewStatus, reviewerNote, banUser, banReason } = req.body ?? {};

  if (typeof reviewStatus !== "string" || !REVIEW_STATUSES.has(reviewStatus)) {
    return res.status(400).json({ error: "reviewStatus must be Confirmed, FalsePositive, or Ignored." });
  }

  if (reviewerNote !== undefined && typeof reviewerNote !== "string") {
    return res.status(400).json({ error: "reviewerNote must be a string when provided." });
  }
  if (banUser !== undefined && typeof banUser !== "boolean") {
    return res.status(400).json({ error: "banUser must be a boolean when provided." });
  }
  if (banReason !== undefined && typeof banReason !== "string") {
    return res.status(400).json({ error: "banReason must be a string when provided." });
  }
  if (banUser && reviewStatus !== "Confirmed") {
    return res.status(400).json({ error: "Players can only be banned when the review is Confirmed." });
  }

  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const assessment = await tx.antiCheatAssessment.update({
        where: { id: req.params.id },
        data: {
          reviewedAt: new Date(),
          reviewStatus,
          reviewerNote: typeof reviewerNote === "string" ? reviewerNote.slice(0, 255) : null,
        },
        include: {
          participant: {
            include: {
              match: true,
              antiCheatTelemetry: true,
            },
          },
        },
      });

      let bannedUser = null;
      const userId = assessment.participant?.userId;
      if (banUser && userId) {
        bannedUser = await tx.user.update({
          where: { id: userId },
          data: {
            bannedAt: new Date(),
            banReason: (typeof banReason === "string" && banReason.trim()
              ? banReason.trim()
              : typeof reviewerNote === "string" && reviewerNote.trim()
                ? reviewerNote.trim()
                : "Confirmed anti-cheat violation.").slice(0, 255),
            bannedByAdminId: req.user!.userId,
          },
          select: {
            id: true,
            username: true,
            bannedAt: true,
            banReason: true,
          },
        });
      }

      return { assessment, bannedUser };
    });

    return res.json(result);
  } catch (error: any) {
    if (error?.code === "P2025") {
      return res.status(404).json({ error: "Anti-cheat assessment not found." });
    }
    console.error("[AntiCheatRoute] Failed to review assessment:", error);
    return res.status(500).json({ error: "Unable to review anti-cheat assessment." });
  }
});

router.get("/players/:userId", async (req: AuthenticatedRequest, res: Response) => {
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
