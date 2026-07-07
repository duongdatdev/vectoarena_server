import rateLimit from "express-rate-limit";

export const web3ConfirmLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many web3 confirmation requests. Try again in a minute." },
});

export const walletVerifyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many wallet verification attempts. Try again in a minute." },
});
