import { Router, Response } from "express";
import prisma from "../database/prisma";
import { AuthenticatedRequest, authenticateToken } from "../middleware/auth";
import { DEFAULT_PLAYER_SKIN_ID, getPlayerSkinById, PLAYER_SKIN_CATALOG } from "../managers/SkinCatalog";
import { ProgressionManager } from "../managers/ProgressionManager";

const router = Router();

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

  const user = await (prisma as any).user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      vecBalance: true,
      coinBalance: true,
      level: true,
      xp: true,
      loadout: true,
      skinInventory: {
        where: { skinType: "PLAYER" },
        select: { skinCode: true },
      },
    },
  });

  if (!user) {
    return null;
  }

  const ownedSkins = user.skinInventory.map((skin: { skinCode: string }) => skin.skinCode);
  const equippedPlayerSkin = user.loadout?.equippedPlayerSkin || DEFAULT_PLAYER_SKIN_ID;

  return {
    username: user.username,
    vecBalance: user.vecBalance,
    coinBalance: user.coinBalance,
    ...ProgressionManager.buildResult(user.level, user.xp),
    equippedPlayerSkin,
    ownedSkins,
    shopSkins: PLAYER_SKIN_CATALOG.map((skin) => ({
      ...skin,
      owned: ownedSkins.includes(skin.id),
      equipped: equippedPlayerSkin === skin.id,
    })),
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

router.post("/buy-skin", authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { skinId } = req.body as { skinId?: string };

  if (!skinId) {
    return res.status(400).json({ error: "skinId is required." });
  }

  const skin = getPlayerSkinById(skinId);
  if (!skin) {
    return res.status(404).json({ error: "Skin not found." });
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
          select: { coinBalance: true },
        });

        if (!user) {
          throw new Error("USER_NOT_FOUND");
        }

        if (user.coinBalance < skin.price) {
          throw new Error("NOT_ENOUGH_COINS");
        }

        await tx.user.update({
          where: { id: req.user!.userId },
          data: { coinBalance: { decrement: skin.price } },
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
            currencyType: "COIN",
            type: "PURCHASE",
            amount: -skin.price,
            balanceBefore: user.coinBalance,
            balanceAfter: user.coinBalance - skin.price,
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

    const ownedSkin = await (prisma as any).skinInventory.findUnique({
      where: {
        userId_skinCode: {
          userId: req.user!.userId,
          skinCode: skin.id,
        },
      },
    });

    if (!ownedSkin) {
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
