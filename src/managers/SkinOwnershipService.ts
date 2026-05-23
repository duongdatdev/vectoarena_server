import prisma from "../database/prisma";
import { DEFAULT_PLAYER_SKIN_ID, getPlayerSkinById, PlayerSkinCatalogItem, SkinOwnershipType } from "./SkinCatalog";

type PrismaLike = typeof prisma | any;

export function getSkinOwnershipType(skin: Pick<PlayerSkinCatalogItem, "ownershipType"> | null | undefined): SkinOwnershipType {
  return skin?.ownershipType ?? "OFFCHAIN";
}

export async function userOwnsSkin(userId: string, skinId: string, db: PrismaLike = prisma): Promise<boolean> {
  const skin = getPlayerSkinById(skinId);
  if (!skin) {
    return false;
  }

  if (getSkinOwnershipType(skin) === "NFT") {
    const nftSkin = await db.userNftSkinCache.findFirst({
      where: {
        userId,
        skinId,
        balance: { gt: 0 },
      },
      select: { id: true },
    });

    return Boolean(nftSkin);
  }

  const inventorySkin = await db.skinInventory.findUnique({
    where: {
      userId_skinCode: {
        userId,
        skinCode: skinId,
      },
    },
    select: { id: true },
  });

  return Boolean(inventorySkin);
}

export async function validateEquippedSkinOrFallback(
  userId: string,
  skinId: string | null | undefined,
  options: { db?: PrismaLike; updateLoadout?: boolean } = {}
): Promise<{ skinId: string; valid: boolean; fallback: boolean }> {
  const db = options.db ?? prisma;
  const requestedSkinId = skinId || DEFAULT_PLAYER_SKIN_ID;
  const isValid = await userOwnsSkin(userId, requestedSkinId, db);

  if (isValid) {
    return { skinId: requestedSkinId, valid: true, fallback: false };
  }

  if (options.updateLoadout) {
    await db.userLoadout.upsert({
      where: { userId },
      update: { equippedPlayerSkin: DEFAULT_PLAYER_SKIN_ID },
      create: {
        userId,
        equippedPlayerSkin: DEFAULT_PLAYER_SKIN_ID,
      },
    });
  }

  return { skinId: DEFAULT_PLAYER_SKIN_ID, valid: false, fallback: true };
}
