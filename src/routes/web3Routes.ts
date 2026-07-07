import { Router, Request, Response } from 'express';
import prisma from '../database/prisma';
import { web3Manager } from '../managers/Web3Manager';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.post('/link-wallet', authenticateToken, async (req: Request, res: Response): Promise<any> => {
    return res.status(410).json({ error: "Use GET /wallet/nonce and POST /wallet/verify to link a wallet." });
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
            const refreshed = await prisma.user.findUnique({
                where: { id: userId },
                select: { vecUnlockedBalance: true },
            });
            const newUnlockedBalance = refreshed?.vecUnlockedBalance ?? (user.vecUnlockedBalance + amount);
            return res.status(200).json({ success: true, amount, newUnlockedBalance });
        } else {
            return res.status(400).json({ error: "Invalid transaction or deposit not verified" });
        }
    } catch (error) {
        console.error("Deposit Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

export default router;
