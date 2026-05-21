CREATE TYPE "NftPurchaseStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

CREATE TABLE "NftPurchaseHistory" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "walletAddress" VARCHAR(64) NOT NULL,
    "skinId" VARCHAR(64) NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" VARCHAR(64) NOT NULL,
    "tokenId" VARCHAR(128) NOT NULL,
    "txHash" VARCHAR(128) NOT NULL,
    "status" "NftPurchaseStatus" NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NftPurchaseHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NftPurchaseHistory_txHash_key" ON "NftPurchaseHistory"("txHash");

CREATE INDEX "NftPurchaseHistory_userId_createdAt_idx" ON "NftPurchaseHistory"("userId", "createdAt");

CREATE INDEX "NftPurchaseHistory_walletAddress_chainId_contractAddress_idx" ON "NftPurchaseHistory"("walletAddress", "chainId", "contractAddress");

CREATE INDEX "NftPurchaseHistory_skinId_status_idx" ON "NftPurchaseHistory"("skinId", "status");

ALTER TABLE "NftPurchaseHistory" ADD CONSTRAINT "NftPurchaseHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NftPurchaseHistory" ADD CONSTRAINT "NftPurchaseHistory_skinId_chainId_contractAddress_tokenId_fkey" FOREIGN KEY ("skinId", "chainId", "contractAddress", "tokenId") REFERENCES "SkinNftMapping"("skinId", "chainId", "contractAddress", "tokenId") ON DELETE CASCADE ON UPDATE CASCADE;
