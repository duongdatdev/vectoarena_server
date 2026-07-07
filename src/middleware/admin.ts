import { NextFunction, Response } from "express";
import prisma from "../database/prisma";
import { AuthenticatedRequest } from "./auth";

export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ error: "User authentication is required." });
  }
  const username = req.user!.username;

  try {
    const user = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });

    if (!user || user.role !== "ADMIN") {
      return res.status(403).json({ error: "Admin privileges are required." });
    }

    req.user = {
      userId,
      username,
      role: user.role,
    };
    return next();
  } catch (error) {
    console.error("[AdminMiddleware] Failed to verify admin role:", error);
    return res.status(500).json({ error: "Unable to verify admin privileges." });
  }
}
