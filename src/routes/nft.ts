import { ethers } from "ethers";
import { Router, Response } from "express";
import prisma from "../database/prisma";
import { AuthenticatedRequest, authenticateToken } from "../middleware/auth";
import {
  getNftRpcUrl,
  NftOwnershipResult,
  NftOwnershipServiceError,
  nftOwnershipService,
} from "../managers/NftOwnershipService";
import { web3ConfirmLimiter } from "../middleware/rateLimiters";
import { NFT_MIN_CONFIRMATIONS } from "../config/env";

const router = Router();
const SKIN_PURCHASED_EVENT_ABI = ["event SkinPurchased(address buyer, uint256 tokenId, uint256 price)"];
const skinPurchasedInterface = new ethers.Interface(SKIN_PURCHASED_EVENT_ABI);
const ERC1155_MINT_EVENT_ABI = [
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
];
const erc1155MintInterface = new ethers.Interface(ERC1155_MINT_EVENT_ABI);
const NFT_PURCHASE_FUNCTION_ABI = ["function buySkin(uint256 tokenId)"];
const nftPurchaseInterface = new ethers.Interface(NFT_PURCHASE_FUNCTION_ABI);

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

type PurchaseConfirmBody = {
  skinId?: unknown;
  txHash?: unknown;
};

type SkinPurchasedEvent = {
  buyer: string;
  tokenId: string;
  price: string;
};

type Erc1155MintEvent = {
  to: string;
  tokenId: string;
  value: bigint;
};

class TxHashReplayError extends Error {
  constructor() {
    super("NFT purchase transaction hash has already been processed.");
    this.name = "TxHashReplayError";
  }
}

function getNftSyncLimit(): number | undefined {
  const rawLimit = process.env.NFT_SYNC_MAX_ITEMS;
  if (!rawLimit) {
    return undefined;
  }

  const limit = Number(rawLimit);
  return Number.isInteger(limit) && limit > 0 ? limit : undefined;
}

function isValidTxHash(value: unknown): value is string {
  return typeof value === "string" && ethers.isHexString(value, 32);
}

function getNftPurchaseProvider(chainId: number): ethers.JsonRpcProvider {
  const rpcUrl = getNftRpcUrl(chainId);
  if (!rpcUrl) {
    throw new NftOwnershipServiceError("NFT RPC URL is not configured for this chain.", "NFT_RPC_NOT_CONFIGURED", {
      chainId,
      expectedEnv: `NFT_RPC_URL_${chainId}`,
      fallbackEnv: chainId === 11155111 ? "SEPOLIA_RPC_URL" : chainId === 84532 ? "RPC_URL_BASE_SEPOLIA" : undefined,
    });
  }

  return new ethers.JsonRpcProvider(rpcUrl, chainId);
}

function findSkinPurchasedEvents(
  logs: ReadonlyArray<{ address: string; topics: readonly string[]; data: string }>,
  contractAddress: string
): SkinPurchasedEvent[] {
  const events: SkinPurchasedEvent[] = [];

  for (const log of logs) {
    if (!ethers.isAddress(log.address) || ethers.getAddress(log.address) !== contractAddress) {
      continue;
    }

    try {
      const parsed = skinPurchasedInterface.parseLog({
        topics: Array.from(log.topics),
        data: log.data,
      });

      if (!parsed || parsed.name !== "SkinPurchased") {
        continue;
      }

      events.push({
        buyer: ethers.getAddress(String(parsed.args.buyer)),
        tokenId: parsed.args.tokenId.toString(),
        price: parsed.args.price.toString(),
      });
    } catch {
      continue;
    }
  }

  return events;
}

function findErc1155MintEvents(
  logs: ReadonlyArray<{ address: string; topics: readonly string[]; data: string }>,
  contractAddress: string
): Erc1155MintEvent[] {
  const events: Erc1155MintEvent[] = [];

  for (const log of logs) {
    if (!ethers.isAddress(log.address) || ethers.getAddress(log.address) !== contractAddress) {
      continue;
    }

    try {
      const parsed = erc1155MintInterface.parseLog({
        topics: Array.from(log.topics),
        data: log.data,
      });

      if (
        !parsed ||
        parsed.name !== "TransferSingle" ||
        ethers.getAddress(String(parsed.args.from)) !== ethers.ZeroAddress
      ) {
        continue;
      }

      events.push({
        to: ethers.getAddress(String(parsed.args.to)),
        tokenId: parsed.args.id.toString(),
        value: BigInt(parsed.args.value),
      });
    } catch {
      continue;
    }
  }

  return events;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
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

router.post("/purchase/confirm", web3ConfirmLimiter, authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ error: "User authentication is required." });
  }

  const body = req.body as PurchaseConfirmBody;
  const skinId = typeof body.skinId === "string" ? body.skinId.trim() : "";
  if (!skinId) {
    return res.status(400).json({
      error: "skinId is required.",
      code: "INVALID_SKIN_ID",
    });
  }

  if (!isValidTxHash(body.txHash)) {
    return res.status(400).json({
      error: "A valid transaction hash is required.",
      code: "INVALID_TX_HASH",
    });
  }

  const txHash = body.txHash.toLowerCase();

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

    if (!ethers.isAddress(user.walletAddress)) {
      return res.status(400).json({
        error: "User has an invalid linked wallet.",
        code: "INVALID_WALLET_ADDRESS",
      });
    }

    const mapping = await (prisma as any).skinNftMapping.findFirst({
      where: {
        skinId,
        active: true,
      },
      orderBy: [{ chainId: "asc" }, { tokenId: "asc" }],
      select: {
        skinId: true,
        chainId: true,
        contractAddress: true,
        tokenId: true,
        standard: true,
      },
    });

    if (!mapping) {
      return res.status(404).json({
        error: "Active NFT skin mapping not found.",
        code: "NFT_MAPPING_NOT_FOUND",
      });
    }

    if (!ethers.isAddress(mapping.contractAddress)) {
      return res.status(500).json({
        error: "NFT skin mapping has an invalid contract address.",
        code: "INVALID_NFT_MAPPING",
      });
    }

    const processedPurchase = await (prisma as any).nftPurchaseHistory.findUnique({
      where: { txHash },
      select: { id: true },
    });

    if (processedPurchase) {
      return res.status(409).json({
        error: "NFT purchase transaction hash has already been processed.",
        code: "TX_HASH_REPLAYED",
      });
    }

    const expectedContractAddress = ethers.getAddress(mapping.contractAddress);
    const userWalletAddress = ethers.getAddress(user.walletAddress);
    const provider = getNftPurchaseProvider(mapping.chainId);
    const network = await provider.getNetwork();

    if (Number(network.chainId) !== mapping.chainId) {
      return res.status(502).json({
        error: "Configured NFT RPC is connected to an unexpected chain.",
        code: "RPC_CHAIN_MISMATCH",
        expectedChainId: mapping.chainId,
        actualChainId: Number(network.chainId),
      });
    }

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return res.status(202).json({
        error: "Transaction receipt is not available yet.",
        code: "TX_PENDING",
        pending: true,
      });
    }

    if (receipt.status !== 1) {
      return res.status(400).json({
        error: "NFT purchase transaction failed.",
        code: "TX_FAILED",
      });
    }

    const currentBlockNumber = await provider.getBlockNumber();
    const confirmations = currentBlockNumber - receipt.blockNumber + 1;
    if (confirmations < NFT_MIN_CONFIRMATIONS) {
      return res.status(202).json({
        error: "Transaction is waiting for additional confirmations.",
        code: "TX_UNCONFIRMED",
        pending: true,
        confirmations,
        requiredConfirmations: NFT_MIN_CONFIRMATIONS,
      });
    }

    if (!receipt.to || !ethers.isAddress(receipt.to) || ethers.getAddress(receipt.to) !== expectedContractAddress) {
      return res.status(400).json({
        error: "Transaction was not sent to the expected SkinNFT contract.",
        code: "WRONG_CONTRACT",
      });
    }

    const transaction = await provider.getTransaction(txHash);
    if (!transaction) {
      return res.status(202).json({
        error: "Transaction details are not available yet.",
        code: "TX_PENDING",
        pending: true,
      });
    }

    if (Number(transaction.chainId) !== mapping.chainId) {
      return res.status(400).json({
        error: "Transaction chainId does not match the NFT skin mapping.",
        code: "WRONG_CHAIN",
        expectedChainId: mapping.chainId,
        actualChainId: Number(transaction.chainId),
      });
    }

    if (ethers.getAddress(transaction.from) !== userWalletAddress) {
      return res.status(400).json({
        error: "NFT purchase transaction sender does not match the authenticated user.",
        code: "WRONG_BUYER",
      });
    }

    let purchasedTokenId: string | null = null;
    try {
      const parsedTransaction = nftPurchaseInterface.parseTransaction({
        data: transaction.data,
        value: transaction.value,
      });
      purchasedTokenId = parsedTransaction?.name === "buySkin" ? parsedTransaction.args.tokenId.toString() : null;
    } catch {
      purchasedTokenId = null;
    }

    if (purchasedTokenId !== mapping.tokenId) {
      return res.status(400).json({
        error: "Transaction did not call buySkin for the requested NFT skin.",
        code: "WRONG_PURCHASE_CALL",
      });
    }

    const purchaseEvents = findSkinPurchasedEvents(receipt.logs, expectedContractAddress);
    const matchingEvent = purchaseEvents.find(
      (event) => event.buyer === userWalletAddress && event.tokenId === mapping.tokenId
    );
    const matchingMint = findErc1155MintEvents(receipt.logs, expectedContractAddress).find(
      (event) => event.to === userWalletAddress && event.tokenId === mapping.tokenId && event.value > 0n
    );

    if (!matchingEvent && !matchingMint) {
      return res.status(400).json({
        error: "NFT mint event does not match the authenticated user and requested skin.",
        code: "NFT_PURCHASE_EVENT_MISMATCH",
      });
    }

    const ownership = await nftOwnershipService.checkNftOwnership({
      walletAddress: user.walletAddress,
      chainId: mapping.chainId,
      contractAddress: mapping.contractAddress,
      tokenId: mapping.tokenId,
      standard: mapping.standard,
    });

    const syncedAt = new Date();
    const cache = await (prisma as any).$transaction(async (tx: any) => {
      const existingPurchase = await tx.nftPurchaseHistory.findUnique({
        where: { txHash },
        select: { id: true },
      });

      if (existingPurchase) {
        throw new TxHashReplayError();
      }

      await tx.nftPurchaseHistory.create({
        data: {
          userId,
          walletAddress: user.walletAddress,
          skinId: mapping.skinId,
          chainId: mapping.chainId,
          contractAddress: mapping.contractAddress,
          tokenId: mapping.tokenId,
          txHash,
          status: "SUCCESS",
        },
      });

      return await tx.userNftSkinCache.upsert({
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
          txHash,
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
          txHash,
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
    });

    return res.status(200).json({
      walletAddress: user.walletAddress,
      txHash,
      purchase: {
        skinId: mapping.skinId,
        chainId: mapping.chainId,
        contractAddress: mapping.contractAddress,
        tokenId: mapping.tokenId,
        price: matchingEvent?.price ?? null,
      },
      nftSkin: {
        ...cache,
        standard: mapping.standard,
        owned: ownership.owned,
      },
    });
  } catch (error) {
    if (error instanceof TxHashReplayError || isUniqueConstraintError(error)) {
      return res.status(409).json({
        error: "NFT purchase transaction hash has already been processed.",
        code: "TX_HASH_REPLAYED",
      });
    }

    if (error instanceof NftOwnershipServiceError) {
      console.warn("[NftRoute] NFT purchase confirmation failed:", {
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

    console.error("[NftRoute] Failed to confirm NFT purchase:", error);
    return res.status(500).json({ error: "Unable to confirm NFT purchase." });
  }
});

export default router;
