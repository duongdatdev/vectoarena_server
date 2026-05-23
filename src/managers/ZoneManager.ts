import { GameState } from "../schema/GameState";
import { ZoneState } from "../schema/ZoneState";

type ZoneDeathHandler = (victimId: string, damage: number) => void;

export class ZoneManager {
  private state: GameState;
  private zoneStartCenterX = 0;
  private zoneStartCenterZ = 0;
  private zoneStartRadius = 100;
  private onPlayerKilledByZone?: ZoneDeathHandler;

  constructor(state: GameState, onPlayerKilledByZone?: ZoneDeathHandler) {
    this.state = state;
    this.onPlayerKilledByZone = onPlayerKilledByZone;
  }

  public initializeZone() {
    const zone = this.state.zone;
    zone.currentState = "WAITING";
    zone.currentCenterX = 0;
    zone.currentCenterZ = 0;
    zone.currentRadius = 100;
    zone.nextCenterX = 0;
    zone.nextCenterZ = 0;
    zone.nextRadius = 50;
    zone.timer = 0;
    zone.waitTime = 10;
    zone.shrinkDuration = 15;
    zone.currentPhase = 0;
    zone.currentDamagePerSecond = 5;
    zone.damageMultiplierPerPhase = 1.5;
    zone.shrinkFactor = 0.5;

    this.zoneStartCenterX = zone.currentCenterX;
    this.zoneStartCenterZ = zone.currentCenterZ;
    this.zoneStartRadius = zone.currentRadius;
  }

  public updateZone() {
    const zone = this.state.zone;
    if (this.state.matchState !== "PLAYING" || zone.currentState === "MATCHENDED") {
      return;
    }

    zone.timer += 0.1;
    this.applyZoneDamage();

    if (zone.currentState === "WAITING") {
      if (zone.timer >= zone.waitTime) {
        zone.currentState = "SHRINKING";
        zone.timer = 0;
        this.zoneStartCenterX = zone.currentCenterX;
        this.zoneStartCenterZ = zone.currentCenterZ;
        this.zoneStartRadius = zone.currentRadius;
      }
      return;
    }

    if (zone.currentState === "SHRINKING") {
      const progress = Math.min(zone.timer / zone.shrinkDuration, 1);
      zone.currentCenterX = this.zoneStartCenterX + (zone.nextCenterX - this.zoneStartCenterX) * progress;
      zone.currentCenterZ = this.zoneStartCenterZ + (zone.nextCenterZ - this.zoneStartCenterZ) * progress;
      zone.currentRadius = this.zoneStartRadius + (zone.nextRadius - this.zoneStartRadius) * progress;

      if (progress >= 1) {
        zone.currentCenterX = zone.nextCenterX;
        zone.currentCenterZ = zone.nextCenterZ;
        zone.currentRadius = zone.nextRadius;
        zone.currentPhase += 1;

        if (zone.currentRadius <= 1) {
          zone.currentState = "MATCHENDED";
          zone.timer = 0;
          return;
        }

        zone.currentDamagePerSecond *= zone.damageMultiplierPerPhase;
        this.generateNextZone(zone);
        zone.currentState = "WAITING";
        zone.timer = 0;
      }
    }
  }

  private generateNextZone(zone: ZoneState) {
    zone.nextRadius = zone.currentRadius * zone.shrinkFactor;
    if (zone.nextRadius < 1) {
      zone.nextRadius = 0;
    }

    const maxOffset = zone.currentRadius - zone.nextRadius;
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * maxOffset;
    zone.nextCenterX = zone.currentCenterX + Math.cos(angle) * distance;
    zone.nextCenterZ = zone.currentCenterZ + Math.sin(angle) * distance;
  }

  private applyZoneDamage() {
    const zone = this.state.zone;
    const damage = zone.currentDamagePerSecond * 0.1; // update loop is every 100ms

    this.state.players.forEach((player, sessionId) => {
      if (player.isDead || player.hp <= 0) return; // Player is already dead

      const dx = player.x - zone.currentCenterX;
      const dz = player.z - zone.currentCenterZ;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance > zone.currentRadius) {
        player.hp = Math.max(0, player.hp - damage);
        if (player.hp <= 0) {
          console.log(`[ZoneManager] Player ${player.username} (${sessionId}) died to the zone.`);
          this.onPlayerKilledByZone?.(sessionId, damage);
        }
      }
    });
  }
}
