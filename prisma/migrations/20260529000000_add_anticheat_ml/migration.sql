-- CreateTable
CREATE TABLE "AntiCheatTelemetry" (
    "id" UUID NOT NULL,
    "matchParticipantId" UUID NOT NULL,
    "shotsAccepted" INTEGER NOT NULL DEFAULT 0,
    "hitsAccepted" INTEGER NOT NULL DEFAULT 0,
    "hitRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "invalidHitCount" INTEGER NOT NULL DEFAULT 0,
    "fireRateRejectCount" INTEGER NOT NULL DEFAULT 0,
    "totalDistance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "movementPerMinute" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxMoveSpeedObserved" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "moveClampCount" INTEGER NOT NULL DEFAULT 0,
    "moveClampRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pickupCount" INTEGER NOT NULL DEFAULT 0,
    "pickupRejectCount" INTEGER NOT NULL DEFAULT 0,
    "meleeAttackCount" INTEGER NOT NULL DEFAULT 0,
    "meleeInvalidCount" INTEGER NOT NULL DEFAULT 0,
    "actionsRejected" INTEGER NOT NULL DEFAULT 0,
    "invalidActionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "killsPerMinute" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "damagePerMinute" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "damagePerKill" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "primaryWeapon" VARCHAR(64),
    "weaponDamage" INTEGER NOT NULL DEFAULT 0,
    "weaponFireRatePerSecond" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allowedMaxHitDistance" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "allowedMaxItemPickupDistance" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "allowedMoveSpeedWithGrace" DOUBLE PRECISION NOT NULL DEFAULT 4.725,
    "featureSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AntiCheatTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AntiCheatAssessment" (
    "id" UUID NOT NULL,
    "matchParticipantId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "label" VARCHAR(32) NOT NULL DEFAULT 'Normal',
    "modelVersion" VARCHAR(64) NOT NULL DEFAULT 'rules-v1',
    "reasonCodes" JSONB,
    "featureSnapshot" JSONB,
    "reviewedAt" TIMESTAMP(3),
    "reviewStatus" VARCHAR(32),
    "reviewerNote" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AntiCheatAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AntiCheatTelemetry_matchParticipantId_key" ON "AntiCheatTelemetry"("matchParticipantId");

-- CreateIndex
CREATE INDEX "AntiCheatAssessment_label_score_createdAt_idx" ON "AntiCheatAssessment"("label", "score", "createdAt");

-- CreateIndex
CREATE INDEX "AntiCheatAssessment_matchParticipantId_createdAt_idx" ON "AntiCheatAssessment"("matchParticipantId", "createdAt");

-- AddForeignKey
ALTER TABLE "AntiCheatTelemetry" ADD CONSTRAINT "AntiCheatTelemetry_matchParticipantId_fkey" FOREIGN KEY ("matchParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AntiCheatAssessment" ADD CONSTRAINT "AntiCheatAssessment_matchParticipantId_fkey" FOREIGN KEY ("matchParticipantId") REFERENCES "MatchParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
