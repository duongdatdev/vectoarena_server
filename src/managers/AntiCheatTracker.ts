export type AntiCheatMatchContext = {
  mode: string;
  maxPlayers: number;
  matchDurationSeconds: number;
  allowedMaxHitDistance: number;
  allowedMaxItemPickupDistance: number;
  allowedMoveSpeedWithGrace: number;
};

export type AntiCheatParticipantResult = {
  participantId: string;
  sessionId: string;
  userId: string | null;
  placement: number;
  isWinner: boolean;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  vecCollected: number;
  vecDropped: number;
  survivedSeconds: number;
  primaryWeapon: string;
  weaponDamage: number;
  weaponFireRatePerSecond: number;
};

export type AntiCheatFeatureSnapshot = AntiCheatMatchContext &
  AntiCheatParticipantResult & {
    shotsAccepted: number;
    hitsAccepted: number;
    hitRate: number;
    invalidHitCount: number;
    fireRateRejectCount: number;
    totalDistance: number;
    movementPerMinute: number;
    maxMoveSpeedObserved: number;
    moveClampCount: number;
    moveClampRate: number;
    pickupCount: number;
    pickupRejectCount: number;
    meleeAttackCount: number;
    meleeInvalidCount: number;
    actionsRejected: number;
    invalidActionRate: number;
    killsPerMinute: number;
    damagePerMinute: number;
    damagePerKill: number;
  };

type ParticipantTelemetry = {
  shotsAccepted: number;
  hitsAccepted: number;
  invalidHitCount: number;
  fireRateRejectCount: number;
  totalDistance: number;
  maxMoveSpeedObserved: number;
  moveClampCount: number;
  moveEventCount: number;
  pickupCount: number;
  pickupRejectCount: number;
  meleeAttackCount: number;
  meleeInvalidCount: number;
  primaryWeapon: string;
  weaponDamage: number;
  weaponFireRatePerSecond: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

export class AntiCheatTracker {
  private readonly participants = new Map<string, ParticipantTelemetry>();

  constructor(private readonly now: () => number = Date.now) {}

  registerParticipant(sessionId: string): void {
    this.getTelemetry(sessionId);
  }

  unregisterParticipant(sessionId: string): void {
    this.markSeen(sessionId);
  }

  trackMove(sessionId: string, distance: number, allowedDistance: number, observedSpeed: number, clamped: boolean): void {
    const telemetry = this.getTelemetry(sessionId);
    telemetry.moveEventCount += 1;
    telemetry.totalDistance += Math.max(0, Math.min(distance, clamped ? allowedDistance : distance));
    telemetry.maxMoveSpeedObserved = Math.max(telemetry.maxMoveSpeedObserved, Math.max(0, observedSpeed));
    if (clamped) {
      telemetry.moveClampCount += 1;
    }
    telemetry.lastSeenAt = this.now();
  }

  trackAcceptedShot(sessionId: string, weapon: string, damage: number, fireRatePerSecond: number): void {
    const telemetry = this.getTelemetry(sessionId);
    telemetry.shotsAccepted += 1;
    telemetry.primaryWeapon = weapon;
    telemetry.weaponDamage = damage;
    telemetry.weaponFireRatePerSecond = fireRatePerSecond;
    telemetry.lastSeenAt = this.now();
  }

  trackFireRateReject(sessionId: string): void {
    const telemetry = this.getTelemetry(sessionId);
    telemetry.fireRateRejectCount += 1;
    telemetry.lastSeenAt = this.now();
  }

  trackAcceptedHit(sessionId: string): void {
    const telemetry = this.getTelemetry(sessionId);
    telemetry.hitsAccepted += 1;
    telemetry.lastSeenAt = this.now();
  }

  trackInvalidHit(sessionId: string): void {
    const telemetry = this.getTelemetry(sessionId);
    telemetry.invalidHitCount += 1;
    telemetry.lastSeenAt = this.now();
  }

  trackPickup(sessionId: string): void {
    const telemetry = this.getTelemetry(sessionId);
    telemetry.pickupCount += 1;
    telemetry.lastSeenAt = this.now();
  }

  trackPickupReject(sessionId: string): void {
    const telemetry = this.getTelemetry(sessionId);
    telemetry.pickupRejectCount += 1;
    telemetry.lastSeenAt = this.now();
  }

  trackMeleeAttack(sessionId: string): void {
    const telemetry = this.getTelemetry(sessionId);
    telemetry.meleeAttackCount += 1;
    telemetry.lastSeenAt = this.now();
  }

  trackInvalidMelee(sessionId: string): void {
    const telemetry = this.getTelemetry(sessionId);
    telemetry.meleeInvalidCount += 1;
    telemetry.lastSeenAt = this.now();
  }

  buildFeatureSnapshot(
    context: AntiCheatMatchContext,
    result: AntiCheatParticipantResult
  ): AntiCheatFeatureSnapshot {
    const telemetry = this.getTelemetry(result.sessionId);
    const survivedSeconds = Math.max(0, result.survivedSeconds || Math.round((telemetry.lastSeenAt - telemetry.firstSeenAt) / 1000));
    const survivedMinutes = Math.max(survivedSeconds / 60, 1 / 60);
    const actionCount =
      telemetry.shotsAccepted +
      telemetry.pickupCount +
      telemetry.meleeAttackCount +
      telemetry.invalidHitCount +
      telemetry.fireRateRejectCount +
      telemetry.pickupRejectCount +
      telemetry.meleeInvalidCount;
    const actionsRejected =
      telemetry.invalidHitCount +
      telemetry.fireRateRejectCount +
      telemetry.pickupRejectCount +
      telemetry.meleeInvalidCount;

    return {
      ...context,
      ...result,
      survivedSeconds,
      primaryWeapon: telemetry.primaryWeapon || result.primaryWeapon,
      weaponDamage: telemetry.weaponDamage || result.weaponDamage,
      weaponFireRatePerSecond: telemetry.weaponFireRatePerSecond || result.weaponFireRatePerSecond,
      shotsAccepted: telemetry.shotsAccepted,
      hitsAccepted: telemetry.hitsAccepted,
      hitRate: this.safeDivide(telemetry.hitsAccepted, telemetry.shotsAccepted),
      invalidHitCount: telemetry.invalidHitCount,
      fireRateRejectCount: telemetry.fireRateRejectCount,
      totalDistance: Math.round(telemetry.totalDistance * 1000) / 1000,
      movementPerMinute: this.safeDivide(telemetry.totalDistance, survivedMinutes),
      maxMoveSpeedObserved: telemetry.maxMoveSpeedObserved,
      moveClampCount: telemetry.moveClampCount,
      moveClampRate: this.safeDivide(telemetry.moveClampCount, Math.max(telemetry.moveEventCount, 1)),
      pickupCount: telemetry.pickupCount,
      pickupRejectCount: telemetry.pickupRejectCount,
      meleeAttackCount: telemetry.meleeAttackCount,
      meleeInvalidCount: telemetry.meleeInvalidCount,
      actionsRejected,
      invalidActionRate: this.safeDivide(actionsRejected, Math.max(actionCount, 1)),
      killsPerMinute: this.safeDivide(result.kills, survivedMinutes),
      damagePerMinute: this.safeDivide(result.damageDealt, survivedMinutes),
      damagePerKill: this.safeDivide(result.damageDealt, Math.max(result.kills, 1)),
    };
  }

  private getTelemetry(sessionId: string): ParticipantTelemetry {
    const existing = this.participants.get(sessionId);
    if (existing) return existing;

    const now = this.now();
    const telemetry: ParticipantTelemetry = {
      shotsAccepted: 0,
      hitsAccepted: 0,
      invalidHitCount: 0,
      fireRateRejectCount: 0,
      totalDistance: 0,
      maxMoveSpeedObserved: 0,
      moveClampCount: 0,
      moveEventCount: 0,
      pickupCount: 0,
      pickupRejectCount: 0,
      meleeAttackCount: 0,
      meleeInvalidCount: 0,
      primaryWeapon: "",
      weaponDamage: 0,
      weaponFireRatePerSecond: 0,
      firstSeenAt: now,
      lastSeenAt: now,
    };
    this.participants.set(sessionId, telemetry);
    return telemetry;
  }

  private markSeen(sessionId: string): void {
    const telemetry = this.getTelemetry(sessionId);
    telemetry.lastSeenAt = this.now();
  }

  private safeDivide(numerator: number, denominator: number): number {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
    return numerator / denominator;
  }
}
