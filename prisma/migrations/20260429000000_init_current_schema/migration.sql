-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('WAITING', 'PLAYING', 'FINISHED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('RIFLE', 'SHOTGUN', 'MEDICAL_KIT', 'VEC', 'AIRDROP');

-- CreateEnum
CREATE TYPE "WeaponType" AS ENUM ('RIFLE', 'SHOTGUN', 'FIST');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('MATCH_REWARD', 'PURCHASE', 'REFUND', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'OFFCHAIN_ONLY');

-- CreateEnum
CREATE TYPE "SkinType" AS ENUM ('WEAPON', 'PLAYER');

-- CreateEnum
CREATE TYPE "SkinSource" AS ENUM ('SHOP', 'REWARD', 'ADMIN');

-- CreateEnum
CREATE TYPE "DeathCause" AS ENUM ('PLAYER', 'ZONE', 'DISCONNECT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SessionPlatform" AS ENUM ('WINDOWS', 'ANDROID', 'IOS', 'WEB', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "displayName" VARCHAR(64),
    "vecBalance" INTEGER NOT NULL DEFAULT 0,
    "walletAddress" VARCHAR(64),
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "totalMatches" INTEGER NOT NULL DEFAULT 0,
    "totalWins" INTEGER NOT NULL DEFAULT 0,
    "totalKills" INTEGER NOT NULL DEFAULT 0,
    "totalDeaths" INTEGER NOT NULL DEFAULT 0,
    "totalDamage" INTEGER NOT NULL DEFAULT 0,
    "bestPlacement" INTEGER,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshToken" VARCHAR(255) NOT NULL,
    "platform" "SessionPlatform" NOT NULL DEFAULT 'UNKNOWN',
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLoadout" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "equippedWeaponSkin" VARCHAR(64),
    "equippedPlayerSkin" VARCHAR(64),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserLoadout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" UUID NOT NULL,
    "roomCode" VARCHAR(64) NOT NULL,
    "mode" VARCHAR(32) NOT NULL DEFAULT 'BATTLE',
    "status" "MatchStatus" NOT NULL DEFAULT 'WAITING',
    "maxPlayers" INTEGER NOT NULL DEFAULT 2,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "zoneConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchParticipant" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "userId" UUID,
    "sessionId" VARCHAR(64) NOT NULL,
    "usernameSnapshot" VARCHAR(64) NOT NULL,
    "joinAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaveAt" TIMESTAMP(3),
    "placement" INTEGER,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "deaths" INTEGER NOT NULL DEFAULT 0,
    "damageDealt" INTEGER NOT NULL DEFAULT 0,
    "damageTaken" INTEGER NOT NULL DEFAULT 0,
    "vecCollected" INTEGER NOT NULL DEFAULT 0,
    "vecDropped" INTEGER NOT NULL DEFAULT 0,
    "vecCarried" INTEGER NOT NULL DEFAULT 0,
    "rewardVec" INTEGER NOT NULL DEFAULT 0,
    "rewardXp" INTEGER NOT NULL DEFAULT 0,
    "survivedSeconds" INTEGER,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MatchParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KillEvent" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "killerParticipantId" UUID,
    "victimParticipantId" UUID NOT NULL,
    "damage" INTEGER NOT NULL DEFAULT 10,
    "weapon" "WeaponType",
    "deathCause" "DeathCause" NOT NULL DEFAULT 'PLAYER',
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "z" DOUBLE PRECISION,
    "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KillEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'OFFCHAIN_ONLY',
    "txHash" VARCHAR(128),
    "chainId" INTEGER,
    "contractAddress" VARCHAR(64),
    "referenceId" VARCHAR(64),
    "note" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkinInventory" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "skinCode" VARCHAR(64) NOT NULL,
    "skinType" "SkinType" NOT NULL,
    "source" "SkinSource" NOT NULL DEFAULT 'SHOP',
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkinInventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_refreshToken_key" ON "UserSession"("refreshToken");

-- CreateIndex
CREATE INDEX "UserSession_userId_expiresAt_idx" ON "UserSession"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserLoadout_userId_key" ON "UserLoadout"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_roomCode_key" ON "Match"("roomCode");

-- CreateIndex
CREATE INDEX "Match_status_createdAt_idx" ON "Match"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MatchParticipant_userId_joinAt_idx" ON "MatchParticipant"("userId", "joinAt");

-- CreateIndex
CREATE UNIQUE INDEX "MatchParticipant_matchId_sessionId_key" ON "MatchParticipant"("matchId", "sessionId");

-- CreateIndex
CREATE INDEX "KillEvent_matchId_happenedAt_idx" ON "KillEvent"("matchId", "happenedAt");

-- CreateIndex
CREATE INDEX "CurrencyTransaction_userId_createdAt_idx" ON "CurrencyTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CurrencyTransaction_type_createdAt_idx" ON "CurrencyTransaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "CurrencyTransaction_status_createdAt_idx" ON "CurrencyTransaction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SkinInventory_userId_skinType_idx" ON "SkinInventory"("userId", "skinType");

-- CreateIndex
CREATE UNIQUE INDEX "SkinInventory_userId_skinCode_key" ON "SkinInventory"("userId", "skinCode");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLoadout" ADD CONSTRAINT "UserLoadout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchParticipant" ADD CONSTRAINT "MatchParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KillEvent" ADD CONSTRAINT "KillEvent_killerParticipantId_fkey" FOREIGN KEY ("killerParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KillEvent" ADD CONSTRAINT "KillEvent_victimParticipantId_fkey" FOREIGN KEY ("victimParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KillEvent" ADD CONSTRAINT "KillEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyTransaction" ADD CONSTRAINT "CurrencyTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkinInventory" ADD CONSTRAINT "SkinInventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
