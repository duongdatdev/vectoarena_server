-- CreateTable
CREATE TABLE "WalletNonce" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "nonce" VARCHAR(128) NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletNonce_nonce_key" ON "WalletNonce"("nonce");

-- CreateIndex
CREATE INDEX "WalletNonce_userId_usedAt_expiresAt_idx" ON "WalletNonce"("userId", "usedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- AddForeignKey
ALTER TABLE "WalletNonce" ADD CONSTRAINT "WalletNonce_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
