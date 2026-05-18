-- CreateEnum
CREATE TYPE "NftTokenStandard" AS ENUM ('ERC721', 'ERC1155');

-- CreateTable
CREATE TABLE "SkinNftMapping" (
    "id" UUID NOT NULL,
    "skinId" VARCHAR(64) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" VARCHAR(64) NOT NULL,
    "tokenId" VARCHAR(128) NOT NULL,
    "standard" "NftTokenStandard" NOT NULL,
    "priceVec" INTEGER,
    "vecTokenAddress" VARCHAR(64),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkinNftMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNftSkinCache" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "walletAddress" VARCHAR(64) NOT NULL,
    "skinId" VARCHAR(64) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" VARCHAR(64) NOT NULL,
    "tokenId" VARCHAR(128) NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "txHash" VARCHAR(128),

    CONSTRAINT "UserNftSkinCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkinNftMapping_skinId_chainId_contractAddress_tokenId_key" ON "SkinNftMapping"("skinId", "chainId", "contractAddress", "tokenId");

-- CreateIndex
CREATE INDEX "SkinNftMapping_skinId_active_idx" ON "SkinNftMapping"("skinId", "active");

-- CreateIndex
CREATE INDEX "SkinNftMapping_chainId_contractAddress_tokenId_idx" ON "SkinNftMapping"("chainId", "contractAddress", "tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "UserNftSkinCache_userId_walletAddress_skinId_chainId_contractAddress_tokenId_key" ON "UserNftSkinCache"("userId", "walletAddress", "skinId", "chainId", "contractAddress", "tokenId");

-- CreateIndex
CREATE INDEX "UserNftSkinCache_userId_skinId_idx" ON "UserNftSkinCache"("userId", "skinId");

-- CreateIndex
CREATE INDEX "UserNftSkinCache_walletAddress_chainId_contractAddress_idx" ON "UserNftSkinCache"("walletAddress", "chainId", "contractAddress");

-- CreateIndex
CREATE INDEX "UserNftSkinCache_lastSyncedAt_idx" ON "UserNftSkinCache"("lastSyncedAt");

-- AddForeignKey
ALTER TABLE "UserNftSkinCache" ADD CONSTRAINT "UserNftSkinCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNftSkinCache" ADD CONSTRAINT "UserNftSkinCache_skinId_chainId_contractAddress_tokenId_fkey" FOREIGN KEY ("skinId", "chainId", "contractAddress", "tokenId") REFERENCES "SkinNftMapping"("skinId", "chainId", "contractAddress", "tokenId") ON DELETE CASCADE ON UPDATE CASCADE;
