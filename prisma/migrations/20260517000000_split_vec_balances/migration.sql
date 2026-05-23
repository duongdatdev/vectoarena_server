CREATE TYPE "VecBucket" AS ENUM ('UNLOCKED', 'LOCKED');

ALTER TABLE "User"
ADD COLUMN "vecUnlockedBalance" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "vecLockedBalance" INTEGER NOT NULL DEFAULT 0;

UPDATE "User"
SET "vecUnlockedBalance" = "vecBalance",
    "vecLockedBalance" = 0;

ALTER TABLE "CurrencyTransaction"
ADD COLUMN "vecBucket" "VecBucket";

UPDATE "CurrencyTransaction"
SET "vecBucket" = 'UNLOCKED'
WHERE "currencyType" = 'VEC';

ALTER TABLE "User"
DROP COLUMN "vecBalance";
