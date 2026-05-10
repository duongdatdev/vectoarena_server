import { Router, Request, Response } from 'express';
import prisma from '../database/prisma';
import { web3Manager } from '../managers/Web3Manager';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// In a production app, you should verify a cryptographic signature (SIWE) here
// to prove the user actually owns the wallet address.
router.post('/link-wallet', authenticateToken, async (req: Request, res: Response): Promise<any> => {
    try {
        const { walletAddress } = req.body;
        const userId = (req as any).user?.userId;

        if (!walletAddress || !userId) {
            return res.status(400).json({ error: "Missing walletAddress or user authentication" });
        }

        // Check if wallet is already linked to another user
        const existing = await prisma.user.findFirst({
            where: { walletAddress: walletAddress.toLowerCase() }
        });

        if (existing && existing.id !== userId) {
            return res.status(400).json({ error: "Wallet already linked to another account" });
        }

        await prisma.user.update({
            where: { id: userId },
            data: { walletAddress: walletAddress.toLowerCase() }
        });

        return res.status(200).json({ success: true, walletAddress: walletAddress.toLowerCase() });
    } catch (error) {
        console.error("Link Wallet Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

router.post('/deposit', authenticateToken, async (req: Request, res: Response): Promise<any> => {
    try {
        const { txHash } = req.body;
        const userId = (req as any).user?.userId;

        if (!txHash || !userId) {
            return res.status(400).json({ error: "Missing txHash or user authentication" });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user || !user.walletAddress) {
            return res.status(400).json({ error: "User has no linked wallet" });
        }

        const amount = await web3Manager.verifyDeposit(txHash, user.walletAddress, userId);

        if (amount !== null && amount > 0) {
            return res.status(200).json({ success: true, amount, newBalance: user.vecBalance + amount });
        } else {
            return res.status(400).json({ error: "Invalid transaction or deposit not verified" });
        }
    } catch (error) {
        console.error("Deposit Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

export default router;
