import { Router, Response } from "express";
import prisma from "../database/prisma";
import { AuthenticatedRequest, authenticateToken } from "../middleware/auth";
import { DEFAULT_PLAYER_SKIN_ID, getPlayerSkinById, PLAYER_SKIN_CATALOG } from "../managers/SkinCatalog";
import { ProgressionManager } from "../managers/ProgressionManager";
import { getSkinOwnershipType, userOwnsSkin, validateEquippedSkinOrFallback } from "../managers/SkinOwnershipService";

const router = Router();
const VALID_TRANSACTION_CURRENCY_TYPES = new Set(["VEC", "COIN"]);
const VALID_TRANSACTION_TYPES = new Set(["PURCHASE", "MATCH_REWARD", "REFUND", "ADMIN_ADJUSTMENT"]);
const DEFAULT_TRANSACTION_LIMIT = 20;
const MAX_TRANSACTION_LIMIT = 100;

type SkinOwnershipSource = "SKIN_INVENTORY" | "NFT_CACHE" | "NONE";

type NftSkinCacheSummary = {
  skinId: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  balance: number;
  lastSyncedAt: Date;
  mapping?: {
    standard: string;
  } | null;
};

type NftMappingSummary = {
  skinId: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  standard: string;
};

function parsePaginationValue(value: unknown, fallback: number, min = 0, max?: number) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsedValue = Number.parseInt(String(rawValue ?? ""), 10);

  if (!Number.isFinite(parsedValue) || parsedValue < min) {
    return fallback;
  }

  return max ? Math.min(parsedValue, max) : parsedValue;
}

async function ensureDefaultPlayerInventory(userId: string) {
  await (prisma as any).skinInventory.upsert({
    where: {
      userId_skinCode: {
        userId,
        skinCode: DEFAULT_PLAYER_SKIN_ID,
      },
    },
    update: {},
    create: {
      userId,
      skinCode: DEFAULT_PLAYER_SKIN_ID,
      skinType: "PLAYER",
      source: "SHOP",
    },
  });

  await (prisma as any).userLoadout.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      equippedPlayerSkin: DEFAULT_PLAYER_SKIN_ID,
    },
  });
}

async function buildPlayerProfile(userId: string) {
  await ensureDefaultPlayerInventory(userId);

  const [user, activeNftMappings] = await (prisma as any).$transaction([
    (prisma as any).user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        walletAddress: true,
        vecUnlockedBalance: true,
        vecLockedBalance: true,
        coinBalance: true,
        level: true,
        xp: true,
        loadout: true,
        skinInventory: {
          where: { skinType: "PLAYER" },
          select: { skinCode: true },
        },
        nftSkinCache: {
          where: { balance: { gt: 0 } },
          orderBy: { lastSyncedAt: "desc" },
          select: {
            skinId: true,
            chainId: true,
            contractAddress: true,
            tokenId: true,
            balance: true,
            lastSyncedAt: true,
            mapping: {
              select: { standard: true },
            },
          },
        },
      },
    }),
    (prisma as any).skinNftMapping.findMany({
      where: { active: true },
      select: {
        skinId: true,
        chainId: true,
        contractAddress: true,
        tokenId: true,
        standard: true,
      },
    }),
  ]);

  if (!user) {
    return null;
  }

  const inventorySkinSet = new Set(user.skinInventory.map((skin: { skinCode: string }) => skin.skinCode));
  const nftCacheBySkinId = new Map<string, NftSkinCacheSummary>();
  for (const cache of user.nftSkinCache as NftSkinCacheSummary[]) {
    if (!nftCacheBySkinId.has(cache.skinId)) {
      nftCacheBySkinId.set(cache.skinId, cache);
    }
  }

  const nftMappingBySkinId = new Map<string, NftMappingSummary>();
  for (const mapping of activeNftMappings as NftMappingSummary[]) {
    if (!nftMappingBySkinId.has(mapping.skinId)) {
      nftMappingBySkinId.set(mapping.skinId, mapping);
    }
  }

  const ownedSkinSet = new Set([
    ...inventorySkinSet,
    ...nftCacheBySkinId.keys(),
  ]);
  const ownedSkins = Array.from(ownedSkinSet);
  const equippedSkinValidation = await validateEquippedSkinOrFallback(userId, user.loadout?.equippedPlayerSkin, {
    updateLoadout: true,
  });
  const equippedPlayerSkin = equippedSkinValidation.skinId;
  const skinOwnership = PLAYER_SKIN_CATALOG.map((skin) => {
    const ownershipType = getSkinOwnershipType(skin);
    const isNftSkin = ownershipType === "NFT";
    const nftCache = isNftSkin ? nftCacheBySkinId.get(skin.id) : null;
    const nftMapping = isNftSkin ? nftMappingBySkinId.get(skin.id) : null;
    const owned = isNftSkin ? Boolean(nftCache && nftCache.balance > 0) : inventorySkinSet.has(skin.id);
    const source: SkinOwnershipSource = owned ? (isNftSkin ? "NFT_CACHE" : "SKIN_INVENTORY") : "NONE";
    const nftInfo =
      isNftSkin && (nftCache || nftMapping)
        ? {
            chainId: nftCache?.chainId ?? nftMapping?.chainId ?? skin.nft?.chainId ?? null,
            contractAddress: nftCache?.contractAddress ?? nftMapping?.contractAddress ?? skin.nft?.contractAddress ?? null,
            tokenId: nftCache?.tokenId ?? nftMapping?.tokenId ?? skin.nft?.tokenId ?? null,
            standard: nftCache?.mapping?.standard ?? nftMapping?.standard ?? null,
            balance: nftCache?.balance ?? 0,
            lastSyncedAt: nftCache?.lastSyncedAt ?? null,
          }
        : null;

    return {
      ...skin,
      skinId: skin.id,
      ownershipType,
      owned,
      canEquip: owned,
      source,
      equipped: equippedPlayerSkin === skin.id,
      currencyType: skin.currencyType,
      price: skin.price,
      nftInfo,
    };
  });

  return {
    username: user.username,
    walletAddress: user.walletAddress,
    vecUnlockedBalance: user.vecUnlockedBalance,
    vecLockedBalance: user.vecLockedBalance,
    coinBalance: user.coinBalance,
    ...ProgressionManager.buildResult(user.level, user.xp),
    equippedPlayerSkin,
    ownedSkins,
    skinOwnership,
    shopSkins: skinOwnership,
  };
}

router.get("/profile", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const profile = await buildPlayerProfile(req.user!.userId);
    if (!profile) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.json(profile);
  } catch (error) {
    console.error("[PlayerRoute] Failed to load profile:", error);
    return res.status(500).json({ error: "Unable to load player profile." });
  }
});

router.get("/transactions", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const currencyType = Array.isArray(req.query.currencyType) ? req.query.currencyType[0] : req.query.currencyType;
  const type = Array.isArray(req.query.type) ? req.query.type[0] : req.query.type;
  const limit = parsePaginationValue(req.query.limit, DEFAULT_TRANSACTION_LIMIT, 1, MAX_TRANSACTION_LIMIT);
  const offset = parsePaginationValue(req.query.offset, 0);

  if (currencyType && !VALID_TRANSACTION_CURRENCY_TYPES.has(String(currencyType))) {
    return res.status(400).json({ error: "Invalid currencyType." });
  }

  if (type && !VALID_TRANSACTION_TYPES.has(String(type))) {
    return res.status(400).json({ error: "Invalid transaction type." });
  }

  const where: any = {
    userId: req.user!.userId,
  };

  if (currencyType) {
    where.currencyType = String(currencyType);
  }

  if (type) {
    where.type = String(type);
  }

  try {
    const [transactions, total] = await (prisma as any).$transaction([
      (prisma as any).currencyTransaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          currencyType: true,
          vecBucket: true,
          type: true,
          amount: true,
          balanceBefore: true,
          balanceAfter: true,
          status: true,
          txHash: true,
          chainId: true,
          contractAddress: true,
          referenceId: true,
          note: true,
          createdAt: true,
        },
      }),
      (prisma as any).currencyTransaction.count({ where }),
    ]);

    return res.json({
      transactions,
      limit,
      offset,
      total,
    });
  } catch (error) {
    console.error("[PlayerRoute] Failed to load transactions:", error);
    return res.status(500).json({ error: "Unable to load player transactions." });
  }
});

router.post("/buy-skin", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { skinId } = req.body as { skinId?: string };

  if (!skinId) {
    return res.status(400).json({ error: "skinId is required." });
  }

  const skin = getPlayerSkinById(skinId);
  if (!skin) {
    return res.status(404).json({ error: "Skin not found." });
  }

  if (getSkinOwnershipType(skin) === "NFT") {
    return res.status(403).json({
      error: "NFT skins must be acquired through the NFT flow.",
      code: "NFT_SKIN_REQUIRES_NFT_FLOW",
      ownershipType: "NFT",
    });
  }

  try {
    await (prisma as any).$transaction(async (tx: any) => {
      await tx.skinInventory.upsert({
        where: {
          userId_skinCode: {
            userId: req.user!.userId,
            skinCode: DEFAULT_PLAYER_SKIN_ID,
          },
        },
        update: {},
        create: {
          userId: req.user!.userId,
          skinCode: DEFAULT_PLAYER_SKIN_ID,
          skinType: "PLAYER",
          source: "SHOP",
        },
      });

      await tx.userLoadout.upsert({
        where: { userId: req.user!.userId },
        update: {},
        create: {
          userId: req.user!.userId,
          equippedPlayerSkin: DEFAULT_PLAYER_SKIN_ID,
        },
      });

      const existingSkin = await tx.skinInventory.findUnique({
        where: {
          userId_skinCode: {
            userId: req.user!.userId,
            skinCode: skin.id,
          },
        },
      });

      if (!existingSkin) {
        const user = await tx.user.findUnique({
          where: { id: req.user!.userId },
          select: { coinBalance: true, vecUnlockedBalance: true },
        });

        if (!user) {
          throw new Error("USER_NOT_FOUND");
        }

        const isVecPurchase = skin.currencyType === "VEC";
        const balanceBefore = isVecPurchase ? user.vecUnlockedBalance : user.coinBalance;
        if (balanceBefore < skin.price) {
          throw new Error(isVecPurchase ? "NOT_ENOUGH_VEC" : "NOT_ENOUGH_COINS");
        }

        await tx.user.update({
          where: { id: req.user!.userId },
          data: isVecPurchase
            ? { vecUnlockedBalance: { decrement: skin.price } }
            : { coinBalance: { decrement: skin.price } },
        });

        await tx.skinInventory.create({
          data: {
            userId: req.user!.userId,
            skinCode: skin.id,
            skinType: "PLAYER",
            source: "SHOP",
          },
        });

        await tx.currencyTransaction.create({
          data: {
            userId: req.user!.userId,
            currencyType: skin.currencyType,
            vecBucket: isVecPurchase ? "UNLOCKED" : null,
            type: "PURCHASE",
            amount: -skin.price,
            balanceBefore,
            balanceAfter: balanceBefore - skin.price,
            status: "OFFCHAIN_ONLY",
            referenceId: skin.id,
            note: `Purchased player skin ${skin.id}`,
          },
        });
      }

      await tx.userLoadout.update({
        where: { userId: req.user!.userId },
        data: { equippedPlayerSkin: skin.id },
      });
    });

    const profile = await buildPlayerProfile(req.user!.userId);
    return res.json(profile);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_ENOUGH_COINS") {
      return res.status(400).json({ error: "Not enough coins." });
    }

    if (error instanceof Error && error.message === "NOT_ENOUGH_VEC") {
      return res.status(400).json({ error: "Not enough unlocked VEC." });
    }

    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
      return res.status(404).json({ error: "User not found." });
    }

    console.error("[PlayerRoute] Failed to buy skin:", error);
    return res.status(500).json({ error: "Unable to buy skin." });
  }
});

router.post("/equip-skin", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { skinId } = req.body as { skinId?: string };

  if (!skinId) {
    return res.status(400).json({ error: "skinId is required." });
  }

  const skin = getPlayerSkinById(skinId);
  if (!skin) {
    return res.status(404).json({ error: "Skin not found." });
  }

  try {
    await ensureDefaultPlayerInventory(req.user!.userId);

    const ownsSkin = await userOwnsSkin(req.user!.userId, skin.id);
    if (!ownsSkin) {
      return res.status(403).json({ error: "Skin is not owned." });
    }

    await (prisma as any).userLoadout.update({
      where: { userId: req.user!.userId },
      data: { equippedPlayerSkin: skin.id },
    });

    const profile = await buildPlayerProfile(req.user!.userId);
    return res.json(profile);
  } catch (error) {
    console.error("[PlayerRoute] Failed to equip skin:", error);
    return res.status(500).json({ error: "Unable to equip skin." });
  }
});

export { buildPlayerProfile, ensureDefaultPlayerInventory };
export default router;
