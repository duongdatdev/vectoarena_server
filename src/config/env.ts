import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value || value.trim() === "") {
        console.error(`[env] Missing required environment variable: ${name}`);
        process.exit(1);
    }
    return value;
}

export const JWT_SECRET: string = requireEnv("JWT_SECRET");
export const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || "2h";

const parsedConfirmations = Number(process.env.NFT_MIN_CONFIRMATIONS || "12");
export const NFT_MIN_CONFIRMATIONS: number = Number.isFinite(parsedConfirmations) && parsedConfirmations > 0
    ? Math.floor(parsedConfirmations)
    : 12;

const parsedDepositConfirmations = Number(process.env.DEPOSIT_MIN_CONFIRMATIONS || `${NFT_MIN_CONFIRMATIONS}`);
export const DEPOSIT_MIN_CONFIRMATIONS: number = Number.isFinite(parsedDepositConfirmations) && parsedDepositConfirmations > 0
    ? Math.floor(parsedDepositConfirmations)
    : NFT_MIN_CONFIRMATIONS;

export const ALLOWED_ORIGINS: string[] = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
