import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env";

export type VerifiedTokenPayload = { userId: string; username: string; role?: string };

export class AuthManager {
  public static verifyToken(accessToken: string): VerifiedTokenPayload | null {
    try {
      const decoded = jwt.verify(accessToken, JWT_SECRET) as VerifiedTokenPayload;
      return decoded;
    } catch (e) {
      const err = e as { name?: string; message?: string };
      console.warn(`[AuthManager] verifyToken failed: ${err?.name || "Error"} - ${err?.message || ""}`);
      return null;
    }
  }
}
