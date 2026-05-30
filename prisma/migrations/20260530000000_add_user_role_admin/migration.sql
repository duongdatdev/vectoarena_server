CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'ADMIN');

ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'PLAYER';

CREATE INDEX "User_role_idx" ON "User"("role");
