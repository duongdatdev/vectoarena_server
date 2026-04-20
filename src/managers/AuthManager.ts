import jwt from "jsonwebtoken";

const jwtSecret = process.env.JWT_SECRET || "supersecretkey";

export class AuthManager {
  public static verifyToken(accessToken: string): { userId: string; username: string } | null {
    try {
      const decoded = jwt.verify(accessToken, jwtSecret) as { userId: string; username: string };
      return decoded;
    } catch (e) {
      return null;
    }
  }
}
