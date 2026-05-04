import { NextFunction, Request, Response } from "express";
import { AuthManager } from "../managers/AuthManager";

export type AuthenticatedRequest = Request & {
  user?: {
    userId: string;
    username: string;
  };
};

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
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
  return next();
}
