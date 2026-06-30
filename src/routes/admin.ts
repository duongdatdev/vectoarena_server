import { Router, Response } from "express";
import prisma from "../database/prisma";
import { getPlayerSkinById } from "../managers/SkinCatalog";
import { requireAdmin } from "../middleware/admin";
import { AuthenticatedRequest, authenticateToken } from "../middleware/auth";

const router = Router();
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const USER_ROLES = new Set(["PLAYER", "ADMIN"]);
const CURRENCY_TYPES = new Set(["COIN", "VEC"]);
const VEC_BUCKETS = new Set(["UNLOCKED", "LOCKED"]);

router.use(authenticateToken, requireAdmin);

function parsePositiveInt(value: unknown, fallback: number, max = MAX_LIMIT): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseSearch(value: unknown): string | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" && rawValue.trim() ? rawValue.trim() : undefined;
}

router.get("/me", async (req: AuthenticatedRequest, res: Response) => {
  const user = await (prisma as any).user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, username: true, displayName: true, role: true, lastLoginAt: true },
  });

  return res.json({ user });
});

router.get("/overview", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [
      totalUsers,
      adminUsers,
      totalMatches,
      activeMatches,
      finishedMatches,
      suspiciousAssessments,
      pendingReviews,
      transactions,
      recentUsers,
      recentMatches,
    ] = await (prisma as any).$transaction([
      (prisma as any).user.count(),
      (prisma as any).user.count({ where: { role: "ADMIN" } }),
      (prisma as any).match.count(),
      (prisma as any).match.count({ where: { status: { in: ["WAITING", "PLAYING"] } } }),
      (prisma as any).match.count({ where: { status: "FINISHED" } }),
      (prisma as any).antiCheatAssessment.count({ where: { label: { in: ["Review", "Suspicious"] } } }),
      (prisma as any).antiCheatAssessment.count({
        where: { label: { in: ["Review", "Suspicious"] }, reviewedAt: null },
      }),
      (prisma as any).currencyTransaction.groupBy({
        by: ["currencyType"],
        _sum: { amount: true },
        where: { amount: { gt: 0 } },
      }),
      (prisma as any).user.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, username: true, role: true, level: true, createdAt: true },
      }),
      (prisma as any).match.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, roomCode: true, mode: true, status: true, createdAt: true, endedAt: true },
      }),
    ]);

    const totals = transactions.reduce((acc: Record<string, number>, item: any) => {
      acc[item.currencyType] = item._sum.amount ?? 0;
      return acc;
    }, {});

    return res.json({
      metrics: {
        totalUsers,
        adminUsers,
        totalMatches,
        activeMatches,
        finishedMatches,
        suspiciousAssessments,
        pendingReviews,
        coinIssued: totals.COIN ?? 0,
        vecIssued: totals.VEC ?? 0,
      },
      recentUsers,
      recentMatches,
    });
  } catch (error) {
    console.error("[AdminRoute] Failed to load overview:", error);
    return res.status(500).json({ error: "Unable to load admin overview." });
  }
});

router.get("/users", async (req: AuthenticatedRequest, res: Response) => {
  const page = parsePositiveInt(req.query.page, 1, 10000);
  const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT);
  const search = parseSearch(req.query.search);
  const role = parseSearch(req.query.role);
  const where: any = {};

  if (search) {
    where.OR = [
      { username: { contains: search, mode: "insensitive" } },
      { walletAddress: { contains: search, mode: "insensitive" } },
    ];
  }

  if (role && USER_ROLES.has(role)) {
    where.role = role;
  }

  try {
    const [users, total] = await (prisma as any).$transaction([
      (prisma as any).user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          walletAddress: true,
          level: true,
          xp: true,
          vecUnlockedBalance: true,
          vecLockedBalance: true,
          coinBalance: true,
          totalMatches: true,
          totalWins: true,
          totalKills: true,
          totalDeaths: true,
          bannedAt: true,
          banReason: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      (prisma as any).user.count({ where }),
    ]);

    return res.json({ users, page, limit, total });
  } catch (error) {
    console.error("[AdminRoute] Failed to load users:", error);
    return res.status(500).json({ error: "Unable to load users." });
  }
});

router.get("/users/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await (prisma as any).user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        walletAddress: true,
        vecUnlockedBalance: true,
        vecLockedBalance: true,
        coinBalance: true,
        level: true,
        xp: true,
        totalMatches: true,
        totalWins: true,
        totalKills: true,
        totalDeaths: true,
        totalDamage: true,
        bestPlacement: true,
        bannedAt: true,
        banReason: true,
        bannedByAdminId: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        loadout: true,
        skinInventory: { orderBy: { unlockedAt: "desc" } },
        currencyEvents: { orderBy: { createdAt: "desc" }, take: 25 },
        participation: {
          orderBy: { joinAt: "desc" },
          take: 10,
          include: {
            match: {
              select: { id: true, roomCode: true, mode: true, status: true, startedAt: true, endedAt: true },
            },
          },
        },
        nftSkinCache: { orderBy: { lastSyncedAt: "desc" }, take: 25 },
        nftPurchaseHistory: { orderBy: { createdAt: "desc" }, take: 25 },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const antiCheatAssessments = await (prisma as any).antiCheatAssessment.findMany({
      where: { participant: { userId: req.params.id } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        participant: {
          select: {
            usernameSnapshot: true,
            kills: true,
            deaths: true,
            match: { select: { roomCode: true, mode: true, endedAt: true } },
          },
        },
      },
    });

    return res.json({ user, antiCheatAssessments });
  } catch (error) {
    console.error("[AdminRoute] Failed to load user:", error);
    return res.status(500).json({ error: "Unable to load user." });
  }
});

router.patch("/users/:id/role", async (req: AuthenticatedRequest, res: Response) => {
  const role = typeof req.body?.role === "string" ? req.body.role : "";
  if (!USER_ROLES.has(role)) {
    return res.status(400).json({ error: "role must be PLAYER or ADMIN." });
  }

  if (req.params.id === req.user!.userId && role !== "ADMIN") {
    return res.status(400).json({ error: "Admins cannot remove their own admin role." });
  }

  try {
    const user = await (prisma as any).user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, username: true, role: true },
    });

    return res.json({ user });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return res.status(404).json({ error: "User not found." });
    }
    console.error("[AdminRoute] Failed to update user role:", error);
    return res.status(500).json({ error: "Unable to update user role." });
  }
});

router.patch("/users/:id/unban", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await (prisma as any).user.update({
      where: { id: req.params.id },
      data: {
        bannedAt: null,
        banReason: null,
        bannedByAdminId: null,
      },
      select: {
        id: true,
        username: true,
        role: true,
        bannedAt: true,
        banReason: true,
      },
    });

    return res.json({ user });
  } catch (error: any) {
    if (error?.code === "P2025") {
      return res.status(404).json({ error: "User not found." });
    }
    console.error("[AdminRoute] Failed to unban user:", error);
    return res.status(500).json({ error: "Unable to unban user." });
  }
});

router.post("/users/:id/currency-adjustments", async (req: AuthenticatedRequest, res: Response) => {
  const currencyType = typeof req.body?.currencyType === "string" ? req.body.currencyType : "";
  const vecBucket = typeof req.body?.vecBucket === "string" ? req.body.vecBucket : undefined;
  const amount = Number(req.body?.amount);
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 255) : "Admin adjustment";

  if (!CURRENCY_TYPES.has(currencyType)) {
    return res.status(400).json({ error: "currencyType must be COIN or VEC." });
  }
  if (!Number.isInteger(amount) || amount === 0) {
    return res.status(400).json({ error: "amount must be a non-zero integer." });
  }
  if (currencyType === "VEC" && (!vecBucket || !VEC_BUCKETS.has(vecBucket))) {
    return res.status(400).json({ error: "vecBucket must be UNLOCKED or LOCKED for VEC adjustments." });
  }

  try {
    const result = await (prisma as any).$transaction(async (tx: any) => {
      const user = await tx.user.findUnique({ where: { id: req.params.id } });
      if (!user) return null;

      const balanceField =
        currencyType === "COIN" ? "coinBalance" : vecBucket === "LOCKED" ? "vecLockedBalance" : "vecUnlockedBalance";
      const balanceBefore = user[balanceField];
      const balanceAfter = balanceBefore + amount;

      if (balanceAfter < 0) {
        throw new Error("NEGATIVE_BALANCE");
      }

      const updatedUser = await tx.user.update({
        where: { id: req.params.id },
        data: { [balanceField]: balanceAfter },
        select: {
          id: true,
          username: true,
          coinBalance: true,
          vecUnlockedBalance: true,
          vecLockedBalance: true,
        },
      });

      const transaction = await tx.currencyTransaction.create({
        data: {
          userId: req.params.id,
          currencyType,
          vecBucket: currencyType === "VEC" ? vecBucket : null,
          type: "ADMIN_ADJUSTMENT",
          amount,
          balanceBefore,
          balanceAfter,
          status: "OFFCHAIN_ONLY",
          note,
          referenceId: req.user!.userId,
        },
      });

      return { user: updatedUser, transaction };
    });

    if (!result) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.json(result);
  } catch (error: any) {
    if (error?.message === "NEGATIVE_BALANCE") {
      return res.status(400).json({ error: "Adjustment would make the balance negative." });
    }
    console.error("[AdminRoute] Failed to adjust currency:", error);
    return res.status(500).json({ error: "Unable to adjust currency." });
  }
});

router.post("/users/:id/skins", async (req: AuthenticatedRequest, res: Response) => {
  const skinCode = typeof req.body?.skinCode === "string" ? req.body.skinCode.trim() : "";
  const skin = getPlayerSkinById(skinCode);

  if (!skin) {
    return res.status(400).json({ error: "Unknown player skin code." });
  }

  try {
    const grantedSkin = await (prisma as any).skinInventory.upsert({
      where: { userId_skinCode: { userId: req.params.id, skinCode } },
      update: { source: "ADMIN" },
      create: {
        userId: req.params.id,
        skinCode,
        skinType: "PLAYER",
        source: "ADMIN",
      },
    });

    return res.json({ skin: grantedSkin });
  } catch (error: any) {
    if (error?.code === "P2003") {
      return res.status(404).json({ error: "User not found." });
    }
    console.error("[AdminRoute] Failed to grant skin:", error);
    return res.status(500).json({ error: "Unable to grant skin." });
  }
});

router.get("/matches", async (req: AuthenticatedRequest, res: Response) => {
  const page = parsePositiveInt(req.query.page, 1, 10000);
  const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT);
  const status = parseSearch(req.query.status);
  const where = status ? { status } : {};

  try {
    const [matches, total] = await (prisma as any).$transaction([
      (prisma as any).match.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { participants: true, killEvents: true } },
          participants: {
            orderBy: [{ isWinner: "desc" }, { placement: "asc" }],
            take: 4,
            select: {
              id: true,
              userId: true,
              usernameSnapshot: true,
              placement: true,
              kills: true,
              deaths: true,
              rewardVec: true,
              rewardXp: true,
              isWinner: true,
            },
          },
        },
      }),
      (prisma as any).match.count({ where }),
    ]);

    return res.json({ matches, page, limit, total });
  } catch (error) {
    console.error("[AdminRoute] Failed to load matches:", error);
    return res.status(500).json({ error: "Unable to load matches." });
  }
});

router.get("/transactions", async (req: AuthenticatedRequest, res: Response) => {
  const page = parsePositiveInt(req.query.page, 1, 10000);
  const limit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT);
  const type = parseSearch(req.query.type);
  const status = parseSearch(req.query.status);
  const userId = parseSearch(req.query.userId);
  const where: any = {};

  if (type) where.type = type;
  if (status) where.status = status;
  if (userId) where.userId = userId;

  try {
    const [transactions, total] = await (prisma as any).$transaction([
      (prisma as any).currencyTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, username: true, role: true } },
        },
      }),
      (prisma as any).currencyTransaction.count({ where }),
    ]);

    return res.json({ transactions, page, limit, total });
  } catch (error) {
    console.error("[AdminRoute] Failed to load transactions:", error);
    return res.status(500).json({ error: "Unable to load transactions." });
  }
});

router.get("/nft-mappings", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [mappings, cache, purchases] = await (prisma as any).$transaction([
      (prisma as any).skinNftMapping.findMany({
        orderBy: [{ active: "desc" }, { skinId: "asc" }],
        include: {
          _count: { select: { userCaches: true, purchaseHistory: true } },
        },
      }),
      (prisma as any).userNftSkinCache.findMany({
        orderBy: { lastSyncedAt: "desc" },
        take: 25,
        include: { user: { select: { id: true, username: true } } },
      }),
      (prisma as any).nftPurchaseHistory.findMany({
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { user: { select: { id: true, username: true } } },
      }),
    ]);

    return res.json({ mappings, cache, purchases });
  } catch (error) {
    console.error("[AdminRoute] Failed to load NFT data:", error);
    return res.status(500).json({ error: "Unable to load NFT data." });
  }
});

export default router;
