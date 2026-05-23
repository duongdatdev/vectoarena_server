import { randomBytes } from "crypto";
import { Router, Response } from "express";
import { isAddress, verifyMessage } from "ethers";
import { Prisma } from "@prisma/client";
import prisma from "../database/prisma";
import { AuthenticatedRequest, authenticateToken } from "../middleware/auth";

const router = Router();
const NONCE_TTL_MS = 10 * 60 * 1000;

function normalizeWalletAddress(address: string): string {
  return address.toLowerCase();
}

function buildWalletVerificationMessage(userId: string, nonce: string, issuedAt: Date): string {
  return [
    "VectoArena wallet verification",
    `User: ${userId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`
  ].join("\n");
}

// Endpoint to generate a new nonce for wallet verification
router.get("/nonce", authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ error: "User authentication is required." });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_MS);
    const nonce = randomBytes(32).toString("hex");
    const message = buildWalletVerificationMessage(userId, nonce, issuedAt);

    await (prisma as any).$transaction([
      (prisma as any).walletNonce.updateMany({
        where: {
          userId,
          usedAt: null,
          expiresAt: { gt: issuedAt }
        },
        data: { usedAt: issuedAt }
      }),
      (prisma as any).walletNonce.create({
        data: {
          userId,
          nonce,
          message,
          expiresAt
        }
      })
    ]);

    return res.status(200).json({
      nonce,
      message,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
  } catch (error) {
    console.error("Wallet Nonce Error:", error);
    return res.status(500).json({ error: "Unable to create wallet nonce." });
  }
});

router.post("/verify", authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<any> => {
  const userId = req.user?.userId;
  const { address, signature, nonce } = req.body as {
    address?: string;
    signature?: string;
    nonce?: string;
  };

  if (!userId) {
    return res.status(401).json({ error: "User authentication is required." });
  }

  if (!address || !signature || !nonce) {
    return res.status(400).json({ error: "address, signature, and nonce are required." });
  }

  if (!isAddress(address)) {
    return res.status(400).json({ error: "Invalid wallet address." });
  }

  const normalizedAddress = normalizeWalletAddress(address);

  try {
    const walletNonce = await (prisma as any).walletNonce.findUnique({
      where: { nonce },
      select: {
        id: true,
        userId: true,
        message: true,
        expiresAt: true,
        usedAt: true
      }
    });

    if (!walletNonce || walletNonce.userId !== userId) {
      return res.status(400).json({ error: "Invalid nonce." });
    }

    if (walletNonce.usedAt) {
      return res.status(409).json({ error: "Nonce already used." });
    }

    const now = new Date();
    if (walletNonce.expiresAt <= now) {
      return res.status(410).json({ error: "Nonce expired." });
    }

    let recoveredAddress: string;
    try {
      recoveredAddress = normalizeWalletAddress(verifyMessage(walletNonce.message, signature));
    } catch (error) {
      return res.status(400).json({ error: "Signature invalid." });
    }

    if (recoveredAddress !== normalizedAddress) {
      return res.status(400).json({ error: "Address mismatch." });
    }

    const result = await (prisma as any).$transaction(async (tx: any) => {
      const nonceUpdate = await tx.walletNonce.updateMany({
        where: {
          id: walletNonce.id,
          usedAt: null
        },
        data: { usedAt: now }
      });

      if (nonceUpdate.count !== 1) {
        return { status: "nonce_used" as const };
      }

      const currentUser = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, walletAddress: true }
      });

      if (!currentUser) {
        return { status: "user_not_found" as const };
      }

      if (currentUser.walletAddress) {
        const currentWalletAddress = normalizeWalletAddress(currentUser.walletAddress);
        if (currentWalletAddress !== normalizedAddress) {
          return { status: "account_wallet_mismatch" as const };
        }

        return { status: "linked" as const, walletAddress: currentWalletAddress };
      }

      const existing = await tx.user.findFirst({
        where: { walletAddress: normalizedAddress },
        select: { id: true }
      });

      if (existing && existing.id !== userId) {
        return { status: "wallet_already_linked" as const };
      }

      await tx.user.update({
        where: { id: userId },
        data: { walletAddress: normalizedAddress }
      });

      return { status: "linked" as const, walletAddress: normalizedAddress };
    });

    if (result.status === "nonce_used") {
      return res.status(409).json({ error: "Nonce already used." });
    }

    if (result.status === "user_not_found") {
      return res.status(404).json({ error: "User not found." });
    }

    if (result.status === "account_wallet_mismatch") {
      return res.status(409).json({ error: "Account already linked to another wallet." });
    }

    if (result.status === "wallet_already_linked") {
      return res.status(409).json({ error: "Wallet already linked to another account." });
    }

    return res.status(200).json({ success: true, walletAddress: result.walletAddress });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(409).json({ error: "Wallet already linked to another account." });
    }

    console.error("Wallet Verify Error:", error);
    return res.status(500).json({ error: "Unable to verify wallet." });
  }
});

export default router;
