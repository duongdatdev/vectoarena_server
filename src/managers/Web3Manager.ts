import { ethers } from 'ethers';
import prisma from '../database/prisma';

export class Web3Manager {
    private provider: ethers.JsonRpcProvider;
    private tokenContractAddress: string;
    private treasuryWalletAddress: string;
    
    // Minimal ABI for ERC20 transfer events
    private erc20Abi = [
        "event Transfer(address indexed from, address indexed to, uint256 value)"
    ];

    constructor() {
        const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.tokenContractAddress = (process.env.TOKEN_CONTRACT_ADDRESS || "").toLowerCase();
        this.treasuryWalletAddress = (process.env.TREASURY_WALLET_ADDRESS || "").toLowerCase();
    }

    public async verifyDeposit(txHash: string, walletAddress: string, userId: string): Promise<number | null> {
        try {
            // Check if txHash was already processed
            const existingTx = await prisma.currencyTransaction.findFirst({
                where: { txHash: txHash }
            });

            if (existingTx) {
                console.log(`Transaction ${txHash} already processed.`);
                return null;
            }

            // Fetch transaction receipt
            const receipt = await this.provider.getTransactionReceipt(txHash);
            if (!receipt || receipt.status !== 1) {
                console.log(`Transaction ${txHash} failed or not found.`);
                return null;
            }

            // Filter for Transfer events to the treasury wallet
            const contract = new ethers.Contract(this.tokenContractAddress, this.erc20Abi, this.provider);
            const transferEvents = receipt.logs.map((log) => {
                try {
                    return contract.interface.parseLog({
                        topics: [...log.topics],
                        data: log.data
                    });
                } catch (e) {
                    return null;
                }
            }).filter((parsedLog) => parsedLog?.name === 'Transfer');

            let totalDeposited = 0n;

            for (const event of transferEvents) {
                if (event) {
                    const from = event.args[0].toLowerCase();
                    const to = event.args[1].toLowerCase();
                    const value = event.args[2];

                    if (from === walletAddress.toLowerCase() && to === this.treasuryWalletAddress) {
                        totalDeposited += BigInt(value);
                    }
                }
            }

            if (totalDeposited > 0n) {
                // Convert value (assuming 18 decimals by default)
                // Assuming 1 Token = 1 In-Game VEC. 
                // Adjust this formula if you want a different conversion rate.
                const depositedAmount = Number(ethers.formatUnits(totalDeposited, 18));
                const finalAmount = Math.floor(depositedAmount); // Only give integer amount in game
                
                if (finalAmount > 0) {
                    await prisma.$transaction(async (tx) => {
                        const user = await tx.user.findUnique({ where: { id: userId } });
                        if (!user) throw new Error("User not found");

                        await tx.user.update({
                            where: { id: userId },
                            data: { vecUnlockedBalance: { increment: finalAmount } }
                        });

                        await tx.currencyTransaction.create({
                            data: {
                                userId: userId,
                                currencyType: 'VEC',
                                vecBucket: 'UNLOCKED',
                                type: 'PURCHASE',
                                amount: finalAmount,
                                balanceBefore: user.vecUnlockedBalance,
                                balanceAfter: user.vecUnlockedBalance + finalAmount,
                                status: 'SUCCESS',
                                txHash: txHash,
                                chainId: 11155111,
                                contractAddress: this.tokenContractAddress,
                                note: "Web3 Deposit"
                            }
                        });
                    });

                    return finalAmount;
                }
            }

            return null;
        } catch (error) {
            console.error("Error verifying deposit:", error);
            return null;
        }
    }
}

export const web3Manager = new Web3Manager();
