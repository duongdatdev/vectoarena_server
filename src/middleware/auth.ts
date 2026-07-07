import { NextFunction, Request, Response } from "express";
import { AuthManager } from "../managers/AuthManager";
import prisma from "../database/prisma";

export type AuthenticatedRequest = Request & {
  user?: {
    userId: string;
    username: string;
    role?: string;
  };
};

export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.substring("Bearer ".length) : null;

  if (!token) {
    return res.status(401).json({ error: "Authorization token is required." });
  }

  const decoded = AuthManager.verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }

  req.user = decoded;
  const user = await (prisma as any).user.findUnique({
    where: { id: decoded.userId },
    select: { bannedAt: true, banReason: true },
  });

  if (user?.bannedAt) {
    return res.status(403).json({
      error: "Your account has been banned.",
      code: "ACCOUNT_BANNED",
      reason: user.banReason || "No reason provided.",
    });
  }

  return next();
}
