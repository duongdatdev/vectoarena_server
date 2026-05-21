import { Router, Response } from "express";
import prisma from "../database/prisma";
import { AuthenticatedRequest, authenticateToken } from "../middleware/auth";
import { NftOwnershipResult, NftOwnershipServiceError, nftOwnershipService } from "../managers/NftOwnershipService";

const router = Router();

type SyncedNftSkin = {
  skinId: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  standard: string;
  balance: number;
  owned: boolean;
  lastSyncedAt: Date;
};

type ActiveNftMapping = {
  skinId: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  standard: "ERC721" | "ERC1155";
};

type NftOwnershipSyncResult = {
  mapping: ActiveNftMapping;
  ownership: NftOwnershipResult;
};

function getNftSyncLimit(): number | undefined {
  const rawLimit = process.env.NFT_SYNC_MAX_ITEMS;
  if (!rawLimit) {
    return undefined;
  }

  const limit = Number(rawLimit);
  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

router.post("/sync", authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ error: "User authentication is required." });
  }

  try {
    const user = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        walletAddress: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    if (!user.walletAddress) {
      return res.status(400).json({
        error: "User has no linked wallet.",
        code: "WALLET_NOT_LINKED",
      });
    }

    const activeMappings: ActiveNftMapping[] = await (prisma as any).skinNftMapping.findMany({
      where: { active: true },
      orderBy: [{ skinId: "asc" }, { chainId: "asc" }, { tokenId: "asc" }],
      take: getNftSyncLimit(),
      select: {
        skinId: true,
        chainId: true,
        contractAddress: true,
        tokenId: true,
        standard: true,
      },
    });

    const syncedAt = new Date();
    const syncedSkins: SyncedNftSkin[] = [];

    const ownershipResults: NftOwnershipSyncResult[] = [];
    for (const mapping of activeMappings) {
      const ownership = await nftOwnershipService.checkNftOwnership({
        walletAddress: user.walletAddress,
        chainId: mapping.chainId,
        contractAddress: mapping.contractAddress,
        tokenId: mapping.tokenId,
        standard: mapping.standard,
      });

      ownershipResults.push({
        mapping,
        ownership,
      });
    }

    await (prisma as any).$transaction(async (tx: any) => {
      for (const item of ownershipResults) {
        const { mapping, ownership } = item;
        const cache = await tx.userNftSkinCache.upsert({
          where: {
            userId_walletAddress_skinId_chainId_contractAddress_tokenId: {
              userId,
              walletAddress: user.walletAddress,
              skinId: mapping.skinId,
              chainId: mapping.chainId,
              contractAddress: mapping.contractAddress,
              tokenId: mapping.tokenId,
            },
          },
          update: {
            balance: ownership.balance,
            lastSyncedAt: syncedAt,
          },
          create: {
            userId,
            walletAddress: user.walletAddress,
            skinId: mapping.skinId,
            chainId: mapping.chainId,
            contractAddress: mapping.contractAddress,
            tokenId: mapping.tokenId,
            balance: ownership.balance,
            lastSyncedAt: syncedAt,
          },
          select: {
            skinId: true,
            chainId: true,
            contractAddress: true,
            tokenId: true,
            balance: true,
            lastSyncedAt: true,
          },
        });

        syncedSkins.push({
          ...cache,
          standard: mapping.standard,
          owned: ownership.owned,
        });
      }
    });

    return res.status(200).json({
      walletAddress: user.walletAddress,
      syncedAt,
      nftSkins: syncedSkins,
    });
  } catch (error) {
    if (error instanceof NftOwnershipServiceError) {
      console.warn("[NftRoute] NFT ownership sync failed:", {
        code: error.code,
        message: error.message,
        details: error.details,
      });

      return res.status(502).json({
        error: error.message,
        code: error.code,
        details: error.details,
      });
    }

    console.error("[NftRoute] Failed to sync NFT ownership:", error);
    return res.status(500).json({ error: "Unable to sync NFT ownership." });
  }
});

export default router;
