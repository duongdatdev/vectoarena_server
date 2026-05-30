import { Client, Room, CloseCode } from "colyseus";
import { GameState } from "../schema/GameState";
import { ZoneManager } from "../managers/ZoneManager";
import { AuthManager } from "../managers/AuthManager";
import { PlayerSpawner } from "../managers/PlayerSpawner";
import { ItemSpawner } from "../managers/ItemSpawner";
import { ConfigService, WeaponConfig, WeaponConfigs } from "../managers/ConfigService";
import { BotManager } from "../managers/BotManager";
import prisma from "../database/prisma";
import { DEFAULT_PLAYER_SKIN_ID } from "../managers/SkinCatalog";
import { validateEquippedSkinOrFallback } from "../managers/SkinOwnershipService";
import { ProgressionManager } from "../managers/ProgressionManager";
import { AntiCheatTracker, AntiCheatParticipantResult } from "../managers/AntiCheatTracker";
import { AntiCheatAssessmentService } from "../managers/AntiCheatAssessmentService";

type WeaponType = keyof WeaponConfigs;
type PrismaWeaponType =
  | "RIFLE"
  | "SHOTGUN"
  | "FIST"
  | "PISTOL"
  | "BURST_RIFLE"
  | "SNIPER"
  | "HUNTER_SNIPER"
  | "LAUNCHER"
  | "MACHINE_GUN"
  | "MINIGUN"
  | "BLASTER_SHOTGUN"
  | "REBEL_RIFLE"
  | "SWORD";

const PRISMA_WEAPON_TYPE_BY_RUNTIME_NAME: Record<string, PrismaWeaponType> = {
  Rifle: "RIFLE",
  Shotgun: "SHOTGUN",
  Fist: "FIST",
  Pistol: "PISTOL",
  BurstRifle: "BURST_RIFLE",
  Sniper: "SNIPER",
  HunterSniper: "HUNTER_SNIPER",
  Launcher: "LAUNCHER",
  MachineGun: "MACHINE_GUN",
  Minigun: "MINIGUN",
  BlasterShotgun: "BLASTER_SHOTGUN",
  RebelRifle: "REBEL_RIFLE",
  Sword: "SWORD",
};

export class BattleRoom extends Room<{ state: GameState }> {
  private static readonly DEFAULT_MELEE_WEAPON = "Sword";
  private static readonly AIRDROP_MIN_LEVEL = 5;
  private static readonly CARRIED_VEC_DROP_CHANCE = 0.7;
  private static readonly BONUS_VEC_DROP_CHANCE = 0.2;
  private static readonly VEC_ITEM_TYPE = "VEC";
  private zoneManager!: ZoneManager;
  private static readonly MAX_PLAYER_HP = 100;
  private static readonly ACCEPTED_SHOT_TTL_MS = 2_000;
  private static readonly MELEE_DAMAGE = 35;
  private static readonly MELEE_RANGE = 2.75;
  private static readonly MELEE_ATTACK_ANGLE_DEGREES = 85;
  private static readonly MELEE_COOLDOWN_MS = 700;
  private static readonly MAX_MOVE_SPEED = 3.5;
  private static readonly MOVE_SPEED_GRACE_MULTIPLIER = 1.35;
  private static readonly MOVE_CLAMP_DISTANCE_MARGIN = 0.1;
  private static readonly MOVE_CLAMP_SPEED_MULTIPLIER = 1.5;
  private static readonly MOVE_ANOMALY_SPEED_MULTIPLIER = 1.5;
  private static readonly MOVE_ANOMALY_DISTANCE_MARGIN = 0.2;
  private static readonly MAX_MOVE_DELTA_TIME_MS = 250;
  private botManager: BotManager | null = null;
  private minHumanPlayersToStart = 1;
  private botFillDelayMs = 15000;
  private botFillTimer: NodeJS.Timeout | null = null;
  private maxItemPickupDistance = 3;
  private medicalKitHeal = 30;
  private maxHitDistance = 60;
  private reconnectTimeoutSeconds = 15;
  private weaponConfigs: WeaponConfigs = {
    Rifle: { damage: 10, fireRatePerSecond: 10, maxAmmo: 30 },
    Shotgun: { damage: 25, fireRatePerSecond: 1.5, maxAmmo: 8 },
    Pistol: { damage: 12, fireRatePerSecond: 5, maxAmmo: 12 },
    BurstRifle: { damage: 14, fireRatePerSecond: 8, maxAmmo: 24 },
    Sniper: { damage: 50, fireRatePerSecond: 0.8, maxAmmo: 5 },
    HunterSniper: { damage: 45, fireRatePerSecond: 1, maxAmmo: 6 },
    Launcher: { damage: 60, fireRatePerSecond: 0.5, maxAmmo: 3 },
    MachineGun: { damage: 8, fireRatePerSecond: 14, maxAmmo: 50 },
    Minigun: { damage: 6, fireRatePerSecond: 20, maxAmmo: 80 },
    BlasterShotgun: { damage: 30, fireRatePerSecond: 1.2, maxAmmo: 6 },
    RebelRifle: { damage: 12, fireRatePerSecond: 9, maxAmmo: 25 },
  };
  private lastShootAtBySessionId = new Map<string, number>();
  private acceptedShotsBySessionId = new Map<string, number[]>();
  private lastMoveAtBySessionId = new Map<string, number>();
  private matchRecordId: string | null = null;
  private participantBySessionId = new Map<string, string>();
  private placementBySessionId = new Map<string, number>();
  private finalizedMatchResults = false;
  private isAirdropMode = false;
  private gameOverQueued = false;
  private antiCheatTracker = new AntiCheatTracker();
  private antiCheatAssessmentService = new AntiCheatAssessmentService();

  private toPrismaWeaponType(weapon: string): PrismaWeaponType | null {
    return PRISMA_WEAPON_TYPE_BY_RUNTIME_NAME[weapon] ?? null;
  }

  private async createMatchRecord(): Promise<void> {
    try {
      const match = await (prisma as any).match.create({
        data: {
          roomCode: this.roomId,
          mode: this.isAirdropMode ? "PLAY_TO_AIRDROP" : "BATTLE",
          status: "WAITING",
          maxPlayers: this.maxClients,
        },
      });
      this.matchRecordId = match.id;
    } catch (error) {
      console.error("[BattleRoom] Failed to create match record:", error);
    }
  }

  private async setMatchPlaying(): Promise<void> {
    if (!this.matchRecordId) return;
    try {
      await (prisma as any).match.update({
        where: { id: this.matchRecordId },
        data: {
          status: "PLAYING",
          startedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("[BattleRoom] Failed to set match status PLAYING:", error);
    }
  }

  private getPlacementForSession(sessionId: string): number {
    const recordedPlacement = this.placementBySessionId.get(sessionId);
    if (recordedPlacement) return recordedPlacement;

    const player = this.state.players.get(sessionId);
    if (player && !player.isDead) return 1;

    return Math.max(1, this.maxClients);
  }

  private getHumanPlayerCount(): number {
    let count = 0;
    this.state.players.forEach((_, sessionId) => {
      if (!BotManager.isBotId(sessionId)) {
        count += 1;
      }
    });
    return count;
  }

  private getAliveCombatantCount(): number {
    let count = 0;
    this.state.players.forEach((player) => {
      if (!player.isDead && player.hp > 0) {
        count += 1;
      }
    });
    return count;
  }

  private tryStartMatch(): void {
    if (this.state.matchState !== "WAITING") return;
    const humanPlayerCount = this.getHumanPlayerCount();
    if (humanPlayerCount < this.maxClients) return;

    this.startMatch();
  }

  private scheduleBotFillIfNeeded(): void {
    if (this.state.matchState !== "WAITING") return;

    const humanPlayerCount = this.getHumanPlayerCount();
    if (humanPlayerCount >= this.maxClients) {
      this.clearBotFillTimer();
      this.startMatch();
      return;
    }

    if (humanPlayerCount < this.minHumanPlayersToStart) {
      this.clearBotFillTimer();
      return;
    }

    if (this.botFillTimer) {
      return;
    }

    this.botFillTimer = setTimeout(() => {
      this.botFillTimer = null;
      this.fillBotsAndStartMatch();
    }, this.botFillDelayMs);
  }

  private clearBotFillTimer(): void {
    if (!this.botFillTimer) return;

    clearTimeout(this.botFillTimer);
    this.botFillTimer = null;
  }

  private fillBotsAndStartMatch(): void {
    if (this.state.matchState !== "WAITING") return;

    const humanPlayerCount = this.getHumanPlayerCount();
    if (humanPlayerCount >= this.maxClients) {
      this.startMatch();
      return;
    }

    if (humanPlayerCount < this.minHumanPlayersToStart) {
      return;
    }

    const missingCombatants = Math.max(0, this.maxClients - humanPlayerCount);
    const spawnedBotCount = this.botManager?.spawnBots(missingCombatants) ?? 0;
    if (humanPlayerCount + spawnedBotCount < this.maxClients) {
      console.warn(
        `[BattleRoom] Bot fill skipped start: humans=${humanPlayerCount}, bots=${spawnedBotCount}, maxPlayers=${this.maxClients}`
      );
      return;
    }

    this.startMatch();
  }

  private startMatch(): void {
    if (this.state.matchState !== "WAITING") return;

    this.clearBotFillTimer();
    this.lock();
    this.state.matchState = "PLAYING";
    this.state.aliveCount = this.getAliveCombatantCount();
    this.broadcast("GAME_START");
    void this.setMatchPlaying();
  }

  private queueGameOverIfNeeded(delayMs: number = 3000): void {
    if (this.gameOverQueued || this.state.aliveCount > 1 || this.state.matchState !== "PLAYING") {
      return;
    }

    this.gameOverQueued = true;
    setTimeout(() => this.finishPlayingMatch(), delayMs);
  }

  private finishPlayingMatch(): void {
    if (this.state.matchState !== "PLAYING") return;

    this.state.matchState = "FINISHED";
    this.broadcast("GAME_OVER");
    void this.finalizeMatch("FINISHED");
  }

  private async finalizeMatch(status: "FINISHED" | "ABANDONED"): Promise<void> {
    if (!this.matchRecordId) return;
    if (this.finalizedMatchResults) return;
    this.finalizedMatchResults = true;

    try {
      const matchId = this.matchRecordId;
      const match = await (prisma as any).match.findUnique({
        where: { id: matchId },
        select: { status: true, startedAt: true, maxPlayers: true },
      });

      if (!match || match.status === "FINISHED" || match.status === "ABANDONED") return;

      const participants = await (prisma as any).matchParticipant.findMany({
        where: { matchId },
        select: {
          id: true,
          userId: true,
          sessionId: true,
          kills: true,
          deaths: true,
          damageDealt: true,
          damageTaken: true,
          vecCollected: true,
          vecDropped: true,
          vecCarried: true,
          rewardXp: true,
          rewardVec: true,
          leaveAt: true,
        },
      });

      const shouldAwardXp = status === "FINISHED" && Boolean(match.startedAt);
      const shouldAwardVec = this.isAirdropMode && status === "FINISHED" && Boolean(match.startedAt);
      const maxPlayers = Math.max(1, match.maxPlayers ?? this.maxClients);
      const endedAt = new Date();
      const matchDurationSeconds = match.startedAt
        ? Math.max(0, Math.round((endedAt.getTime() - match.startedAt.getTime()) / 1000))
        : 0;
      const matchResultMessages: Array<{ sessionId: string; payload: Record<string, number | boolean> }> = [];
      const participantResults: AntiCheatParticipantResult[] = [];

      await (prisma as any).$transaction(async (tx: any) => {
        await tx.match.update({
          where: { id: matchId },
          data: {
            status,
            endedAt,
            durationSeconds: matchDurationSeconds,
          },
        });

        for (const participant of participants) {
          const placement = this.getPlacementForSession(participant.sessionId);
          const isWinner = status === "FINISHED" && placement === 1;
          const leftBeforeMatchStarted = Boolean(
            participant.leaveAt && match.startedAt && participant.leaveAt < match.startedAt
          );
          let rewardXp = 0;
          const statePlayer = this.state.players.get(participant.sessionId);
          const vecCarried = Math.max(0, Math.floor(statePlayer?.vecCarried ?? participant.vecCarried ?? 0));
          const survivedSeconds = participant.leaveAt && match.startedAt
            ? Math.max(0, Math.round((participant.leaveAt.getTime() - match.startedAt.getTime()) / 1000))
            : matchDurationSeconds;
          let rewardVec = 0;
          let progressionPayload: Record<string, number | boolean> | null = null;

          if (shouldAwardXp && !leftBeforeMatchStarted && participant.userId && participant.rewardXp === 0) {
            rewardXp = ProgressionManager.calculateMatchXp({
              maxPlayers,
              placement,
              kills: participant.kills,
              isWinner,
            });

            const user = await tx.user.findUnique({
              where: { id: participant.userId },
              select: {
                level: true,
                xp: true,
                totalMatches: true,
                totalWins: true,
                totalKills: true,
                totalDeaths: true,
                bestPlacement: true,
              },
            });

            if (user) {
              const progression = ProgressionManager.addXp({ level: user.level, xp: user.xp }, rewardXp);
              await tx.user.update({
                where: { id: participant.userId },
                data: {
                  level: progression.level,
                  xp: progression.xp,
                  totalMatches: { increment: 1 },
                  totalWins: { increment: isWinner ? 1 : 0 },
                  totalKills: { increment: participant.kills },
                  totalDeaths: { increment: participant.deaths },
                  bestPlacement: user.bestPlacement === null ? placement : Math.min(user.bestPlacement, placement),
                },
              });

              progressionPayload = {
                xpEarned: rewardXp,
                level: progression.level,
                xp: progression.xp,
                xpToNextLevel: progression.xpToNextLevel,
                xpProgress: progression.xpProgress,
                levelsGained: progression.levelsGained,
              };
            }
          }

          if (shouldAwardVec && !leftBeforeMatchStarted && participant.userId && participant.rewardVec === 0) {
            rewardVec = vecCarried;
            if (rewardVec > 0) {
              const user = await tx.user.findUnique({
                where: { id: participant.userId },
                select: { vecLockedBalance: true },
              });

              if (user) {
                await tx.user.update({
                  where: { id: participant.userId },
                  data: {
                    vecLockedBalance: { increment: rewardVec },
                  },
                });

                await tx.currencyTransaction.create({
                  data: {
                    userId: participant.userId,
                    currencyType: "VEC",
                    vecBucket: "LOCKED",
                    type: "MATCH_REWARD",
                    amount: rewardVec,
                    balanceBefore: user.vecLockedBalance,
                    balanceAfter: user.vecLockedBalance + rewardVec,
                    status: "OFFCHAIN_ONLY",
                    referenceId: matchId,
                    note: "Play to Airdrop match reward",
                  },
                });
              }
            }
          }

          if (participant.userId && (progressionPayload || this.isAirdropMode)) {
            matchResultMessages.push({
              sessionId: participant.sessionId,
              payload: {
                placement,
                kills: participant.kills,
                vecEarned: rewardVec,
                ...(progressionPayload ?? {}),
                isWinner,
              },
            });
          }

          await tx.matchParticipant.update({
            where: { id: participant.id },
            data: {
              placement,
              isWinner,
              vecCarried,
              survivedSeconds,
              rewardXp: rewardXp > 0 ? rewardXp : participant.rewardXp,
              rewardVec: rewardVec > 0 ? rewardVec : participant.rewardVec,
            },
          });

          participantResults.push({
            participantId: participant.id,
            sessionId: participant.sessionId,
            userId: participant.userId ?? null,
            placement,
            isWinner,
            kills: participant.kills,
            deaths: participant.deaths,
            damageDealt: participant.damageDealt,
            damageTaken: participant.damageTaken,
            vecCollected: participant.vecCollected,
            vecDropped: participant.vecDropped,
            survivedSeconds,
            primaryWeapon: statePlayer?.currentWeapon ?? "",
            weaponDamage: 0,
            weaponFireRatePerSecond: 0,
          });
        }
      });

      await this.persistAntiCheatTelemetry(matchDurationSeconds, participantResults);

      for (const result of matchResultMessages) {
        const client = this.clients.find((roomClient) => roomClient.sessionId === result.sessionId);
        client?.send("match_result", result.payload);
      }
    } catch (error) {
      console.error("[BattleRoom] Failed to finalize match:", error);
      this.finalizedMatchResults = false;
    }
  }

  private async persistAntiCheatTelemetry(
    matchDurationSeconds: number,
    participantResults: AntiCheatParticipantResult[]
  ): Promise<void> {
    const context = {
      mode: this.isAirdropMode ? "PLAY_TO_AIRDROP" : "BATTLE",
      maxPlayers: this.maxClients,
      matchDurationSeconds,
      allowedMaxHitDistance: this.maxHitDistance,
      allowedMaxItemPickupDistance: this.maxItemPickupDistance,
      allowedMoveSpeedWithGrace: BattleRoom.MAX_MOVE_SPEED * BattleRoom.MOVE_SPEED_GRACE_MULTIPLIER,
    };

    for (const result of participantResults) {
      try {
        const featureSnapshot = this.antiCheatTracker.buildFeatureSnapshot(context, result);

        await (prisma as any).antiCheatTelemetry.upsert({
          where: { matchParticipantId: result.participantId },
          update: {
            shotsAccepted: featureSnapshot.shotsAccepted,
            hitsAccepted: featureSnapshot.hitsAccepted,
            hitRate: featureSnapshot.hitRate,
            invalidHitCount: featureSnapshot.invalidHitCount,
            fireRateRejectCount: featureSnapshot.fireRateRejectCount,
            totalDistance: featureSnapshot.totalDistance,
            movementPerMinute: featureSnapshot.movementPerMinute,
            maxMoveSpeedObserved: featureSnapshot.maxMoveSpeedObserved,
            moveClampCount: featureSnapshot.moveClampCount,
            moveClampRate: featureSnapshot.moveClampRate,
            pickupCount: featureSnapshot.pickupCount,
            pickupRejectCount: featureSnapshot.pickupRejectCount,
            meleeAttackCount: featureSnapshot.meleeAttackCount,
            meleeInvalidCount: featureSnapshot.meleeInvalidCount,
            actionsRejected: featureSnapshot.actionsRejected,
            invalidActionRate: featureSnapshot.invalidActionRate,
            killsPerMinute: featureSnapshot.killsPerMinute,
            damagePerMinute: featureSnapshot.damagePerMinute,
            damagePerKill: featureSnapshot.damagePerKill,
            primaryWeapon: featureSnapshot.primaryWeapon || null,
            weaponDamage: featureSnapshot.weaponDamage,
            weaponFireRatePerSecond: featureSnapshot.weaponFireRatePerSecond,
            allowedMaxHitDistance: featureSnapshot.allowedMaxHitDistance,
            allowedMaxItemPickupDistance: featureSnapshot.allowedMaxItemPickupDistance,
            allowedMoveSpeedWithGrace: featureSnapshot.allowedMoveSpeedWithGrace,
            featureSnapshot,
          },
          create: {
            matchParticipantId: result.participantId,
            shotsAccepted: featureSnapshot.shotsAccepted,
            hitsAccepted: featureSnapshot.hitsAccepted,
            hitRate: featureSnapshot.hitRate,
            invalidHitCount: featureSnapshot.invalidHitCount,
            fireRateRejectCount: featureSnapshot.fireRateRejectCount,
            totalDistance: featureSnapshot.totalDistance,
            movementPerMinute: featureSnapshot.movementPerMinute,
            maxMoveSpeedObserved: featureSnapshot.maxMoveSpeedObserved,
            moveClampCount: featureSnapshot.moveClampCount,
            moveClampRate: featureSnapshot.moveClampRate,
            pickupCount: featureSnapshot.pickupCount,
            pickupRejectCount: featureSnapshot.pickupRejectCount,
            meleeAttackCount: featureSnapshot.meleeAttackCount,
            meleeInvalidCount: featureSnapshot.meleeInvalidCount,
            actionsRejected: featureSnapshot.actionsRejected,
            invalidActionRate: featureSnapshot.invalidActionRate,
            killsPerMinute: featureSnapshot.killsPerMinute,
            damagePerMinute: featureSnapshot.damagePerMinute,
            damagePerKill: featureSnapshot.damagePerKill,
            primaryWeapon: featureSnapshot.primaryWeapon || null,
            weaponDamage: featureSnapshot.weaponDamage,
            weaponFireRatePerSecond: featureSnapshot.weaponFireRatePerSecond,
            allowedMaxHitDistance: featureSnapshot.allowedMaxHitDistance,
            allowedMaxItemPickupDistance: featureSnapshot.allowedMaxItemPickupDistance,
            allowedMoveSpeedWithGrace: featureSnapshot.allowedMoveSpeedWithGrace,
            featureSnapshot,
          },
        });

        await this.antiCheatAssessmentService.assessParticipant(result.participantId, featureSnapshot);
      } catch (error) {
        console.error("[AntiCheat] Failed to persist telemetry:", error);
      }
    }
  }

  private async createParticipantRecord(client: Client, username: string): Promise<void> {
    if (!this.matchRecordId) return;
    try {
      const userId = (client as any).userId as string | undefined;
      const participant = await (prisma as any).matchParticipant.create({
        data: {
          matchId: this.matchRecordId,
          userId: userId ?? null,
          sessionId: client.sessionId,
          usernameSnapshot: username,
        },
      });
      this.participantBySessionId.set(client.sessionId, participant.id);
    } catch (error) {
      console.error("[BattleRoom] Failed to create match participant:", error);
    }
  }

  private async getEquippedPlayerSkin(client: Client): Promise<string> {
    const userId = (client as any).userId as string | undefined;
    if (!userId) {
      return DEFAULT_PLAYER_SKIN_ID;
    }

    try {
      const loadout = await (prisma as any).userLoadout.findUnique({
        where: { userId },
        select: { equippedPlayerSkin: true },
      });

      const validation = await validateEquippedSkinOrFallback(userId, loadout?.equippedPlayerSkin, {
        updateLoadout: true,
      });

      return validation.skinId;
    } catch (error) {
      console.error("[BattleRoom] Failed to validate equipped player skin:", error);
      return DEFAULT_PLAYER_SKIN_ID;
    }
  }

  private async markParticipantLeft(sessionId: string): Promise<void> {
    const participantId = this.participantBySessionId.get(sessionId);
    if (!participantId) return;

    try {
      await (prisma as any).matchParticipant.update({
        where: { id: participantId },
        data: {
          leaveAt: new Date(),
        },
      });
    } catch (error) {
      console.error("[BattleRoom] Failed to mark participant left:", error);
    }
  }

  private async recordKillEvent(
    killerSessionId: string,
    victimSessionId: string,
    damage: number,
    weapon: string
  ): Promise<void> {
    if (!this.matchRecordId) return;

    const killerParticipantId = this.participantBySessionId.get(killerSessionId) ?? null;
    const victimParticipantId = this.participantBySessionId.get(victimSessionId);
    if (!victimParticipantId) {
      if (killerParticipantId) {
        await (prisma as any).matchParticipant.update({
          where: { id: killerParticipantId },
          data: {
            kills: { increment: 1 },
            damageDealt: { increment: damage },
          },
        });
      }
      return;
    }

    const prismaWeaponType = this.toPrismaWeaponType(weapon);

    try {
      await (prisma as any).killEvent.create({
        data: {
          matchId: this.matchRecordId,
          killerParticipantId,
          victimParticipantId,
          damage,
          weapon: prismaWeaponType,
          deathCause: "PLAYER",
        },
      });

      if (killerParticipantId) {
        await (prisma as any).matchParticipant.update({
          where: { id: killerParticipantId },
          data: {
            kills: { increment: 1 },
            damageDealt: { increment: damage },
          },
        });
      }

      await (prisma as any).matchParticipant.update({
        where: { id: victimParticipantId },
        data: {
          deaths: { increment: 1 },
          damageTaken: { increment: damage },
        },
      });
    } catch (error) {
      console.error("[BattleRoom] Failed to record kill event:", error);
    }
  }

  private async recordZoneDeath(victimSessionId: string, damage: number): Promise<void> {
    if (!this.matchRecordId) return;

    const victimParticipantId = this.participantBySessionId.get(victimSessionId);
    if (!victimParticipantId) {
      return;
    }

    try {
      const roundedDamage = Math.max(1, Math.ceil(damage));
      await (prisma as any).killEvent.create({
        data: {
          matchId: this.matchRecordId,
          killerParticipantId: null,
          victimParticipantId,
          damage: roundedDamage,
          weapon: null,
          deathCause: "ZONE",
        },
      });

      await (prisma as any).matchParticipant.update({
        where: { id: victimParticipantId },
        data: {
          deaths: { increment: 1 },
          damageTaken: { increment: roundedDamage },
        },
      });
    } catch (error) {
      console.error("[BattleRoom] Failed to record zone death:", error);
    }
  }

  private handlePlayerDeath(victimId: string, killerId: string, weapon: string, damage: number) {
    const victim = this.state.players.get(victimId);
    const killer = this.state.players.get(killerId);

    if (!victim || !killer) return;

    victim.hp = 0;
    victim.isDead = true;
    this.state.aliveCount = Math.max(0, this.state.aliveCount - 1);
    const victimPlacement = Math.max(1, this.state.aliveCount + 1);
    this.placementBySessionId.set(victimId, victimPlacement);
    killer.kills++;

    console.log(`[BattleRoom] Player ${victim.username} died by ${killer.username}.`);
    void this.recordKillEvent(killerId, victimId, damage, weapon);

    this.broadcast("kill_feed", {
      killerName: killer.username,
      victimName: victim.username,
      weapon: weapon
    });

    if (victim.rangedWeapon && victim.rangedWeapon.length > 0) {
      ItemSpawner.spawnItemAt(this.state, victim.rangedWeapon, victim.x, victim.z);
    }
    
    if (Math.random() < 0.8) {
      ItemSpawner.spawnItemAt(this.state, "MedicalKit", victim.x + 0.5, victim.z + 0.5);
    }

    if (this.isAirdropMode) {
      this.rollVecDropsOnDeath(victimId, victim, victim.x, victim.z);
    }

    this.queueGameOverIfNeeded();
  }

  private handleZoneDeath(victimId: string, damage: number): void {
    const victim = this.state.players.get(victimId);
    if (!victim || victim.isDead) return;

    victim.hp = 0;
    victim.isDead = true;
    this.state.aliveCount = Math.max(0, this.state.aliveCount - 1);
    const victimPlacement = Math.max(1, this.state.aliveCount + 1);
    this.placementBySessionId.set(victimId, victimPlacement);

    console.log(`[BattleRoom] Player ${victim.username} died to the zone.`);
    void this.recordZoneDeath(victimId, damage);

    this.broadcast("kill_feed", {
      killerName: "",
      victimName: victim.username,
      weapon: "Zone"
    });

    if (victim.rangedWeapon && victim.rangedWeapon.length > 0) {
      ItemSpawner.spawnItemAt(this.state, victim.rangedWeapon, victim.x, victim.z);
    }

    if (Math.random() < 0.8) {
      ItemSpawner.spawnItemAt(this.state, "MedicalKit", victim.x + 0.5, victim.z + 0.5);
    }

    if (this.isAirdropMode) {
      this.rollVecDropsOnDeath(victimId, victim, victim.x, victim.z);
    }

    this.queueGameOverIfNeeded();
  }

  private rollVecDropsOnDeath(victimId: string, victim: any, x: number, z: number): void {
    let dropIndex = 0;
    let carriedVecDropped = 0;

    if (victim.vecCarried > 0 && Math.random() < BattleRoom.CARRIED_VEC_DROP_CHANCE) {
      victim.vecCarried = Math.max(0, victim.vecCarried - 1);
      ItemSpawner.spawnItemAt(this.state, BattleRoom.VEC_ITEM_TYPE, x + dropIndex * 0.35, z);
      dropIndex += 1;
      carriedVecDropped += 1;
    }

    if (Math.random() < BattleRoom.BONUS_VEC_DROP_CHANCE) {
      ItemSpawner.spawnItemAt(this.state, BattleRoom.VEC_ITEM_TYPE, x + dropIndex * 0.35, z);
    }

    if (carriedVecDropped > 0) {
      const participantId = this.participantBySessionId.get(victimId);
      if (participantId) {
        void (prisma as any).matchParticipant.update({
          where: { id: participantId },
          data: {
            vecDropped: { increment: carriedVecDropped },
            vecCarried: victim.vecCarried,
          },
        }).catch((error: unknown) => console.error("[BattleRoom] Failed to record VEC death drop:", error));
      }
    }
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
  }

  private normalizeRotation(value: number): number {
    const normalized = value % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  private clamp01(value: number): number {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private getWeaponConfig(weaponType: string): WeaponConfig | null {
    return this.weaponConfigs[weaponType] ?? null;
  }

  private isMeleeWeapon(weaponType: string): boolean {
    return weaponType === BattleRoom.DEFAULT_MELEE_WEAPON;
  }

  private canProcessAction(sessionId: string, cooldownMs: number): boolean {
    const now = Date.now();
    const lastShotAt = this.lastShootAtBySessionId.get(sessionId) ?? 0;

    if (now - lastShotAt < cooldownMs) {
      return false;
    }

    this.lastShootAtBySessionId.set(sessionId, now);
    return true;
  }

  private isTargetInsideMeleeArc(attacker: any, target: any): boolean {
    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > BattleRoom.MELEE_RANGE || distance <= 0.001) {
      return false;
    }

    const rotationRad = (attacker.rotation * Math.PI) / 180;
    const forwardX = Math.sin(rotationRad);
    const forwardZ = Math.cos(rotationRad);
    const directionX = dx / distance;
    const directionZ = dz / distance;
    const dot = forwardX * directionX + forwardZ * directionZ;
    const minDot = Math.cos((BattleRoom.MELEE_ATTACK_ANGLE_DEGREES * 0.5 * Math.PI) / 180);

    return dot >= minDot;
  }

  private canProcessShot(sessionId: string, weaponConfig: WeaponConfig): boolean {
    return this.canProcessAction(sessionId, 1000 / weaponConfig.fireRatePerSecond);
  }

  private trackAcceptedShot(sessionId: string): void {
    const now = Date.now();
    const acceptedShots = this.getRecentAcceptedShots(sessionId, now);
    acceptedShots.push(now);
    this.acceptedShotsBySessionId.set(sessionId, acceptedShots);
  }

  private consumeAcceptedShot(sessionId: string): boolean {
    const acceptedShots = this.getRecentAcceptedShots(sessionId, Date.now());
    if (acceptedShots.length === 0) {
      this.acceptedShotsBySessionId.delete(sessionId);
      return false;
    }

    acceptedShots.shift();
    if (acceptedShots.length === 0) {
      this.acceptedShotsBySessionId.delete(sessionId);
    } else {
      this.acceptedShotsBySessionId.set(sessionId, acceptedShots);
    }

    return true;
  }

  private getRecentAcceptedShots(sessionId: string, now: number): number[] {
    const acceptedShots = this.acceptedShotsBySessionId.get(sessionId) ?? [];
    return acceptedShots.filter((shotAt) => now - shotAt <= BattleRoom.ACCEPTED_SHOT_TTL_MS);
  }

  private getAllowedMoveDistance(sessionId: string, now: number): number {
    const lastMoveAt = this.lastMoveAtBySessionId.get(sessionId);
    this.lastMoveAtBySessionId.set(sessionId, now);

    if (!lastMoveAt) {
      return BattleRoom.MAX_MOVE_SPEED * BattleRoom.MOVE_SPEED_GRACE_MULTIPLIER;
    }

    const elapsedMs = Math.max(0, Math.min(now - lastMoveAt, BattleRoom.MAX_MOVE_DELTA_TIME_MS));
    return BattleRoom.MAX_MOVE_SPEED * BattleRoom.MOVE_SPEED_GRACE_MULTIPLIER * (elapsedMs / 1000);
  }

  private getObservedMoveSpeed(distance: number, allowedDistance: number): number {
    const graceSpeed = BattleRoom.MAX_MOVE_SPEED * BattleRoom.MOVE_SPEED_GRACE_MULTIPLIER;
    if (allowedDistance <= 0 || graceSpeed <= 0) return 0;
    return distance / (allowedDistance / graceSpeed);
  }

  async onCreate(options?: any) {
    this.isAirdropMode = options?.mode === "airdrop";
    const runtimeConfig = await ConfigService.loadActiveConfig();

    this.maxClients = runtimeConfig.maxPlayers;
    this.maxItemPickupDistance = runtimeConfig.maxItemPickupDistance;
    this.medicalKitHeal = runtimeConfig.medicalKitHeal;
    this.maxHitDistance = runtimeConfig.maxHitDistance;
    this.reconnectTimeoutSeconds = runtimeConfig.reconnectTimeoutSeconds;
    this.weaponConfigs = runtimeConfig.weapons;
    this.minHumanPlayersToStart = Math.min(runtimeConfig.minHumanPlayersToStart, runtimeConfig.maxPlayers);
    this.botFillDelayMs = runtimeConfig.botFillDelayMs;

    this.setState(new GameState());
    console.log(
      `[BattleRoom] Room created with config ${runtimeConfig.profileCode} (mode=${this.isAirdropMode ? "PLAY_TO_AIRDROP" : "BATTLE"}, maxPlayers=${this.maxClients}, spawn=${runtimeConfig.initialSpawnCount}, maxBots=${runtimeConfig.botCount}, botFillDelayMs=${runtimeConfig.botFillDelayMs})`
    );

    this.zoneManager = new ZoneManager(this.state, (victimId, damage) => {
      this.handleZoneDeath(victimId, damage);
    });
    this.zoneManager.initializeZone();
    this.botManager = new BotManager({
      state: this.state,
      botCount: runtimeConfig.botCount,
      moveSpeed: runtimeConfig.botMoveSpeed,
      aggroRange: runtimeConfig.botAggroRange,
      meleeRange: runtimeConfig.botMeleeRange,
      meleeDamage: BattleRoom.MELEE_DAMAGE,
      attackCooldownMs: runtimeConfig.botAttackCooldownMs,
      meleeWeapon: BattleRoom.DEFAULT_MELEE_WEAPON,
      onMeleeAttack: (attackerId, targetId) => {
        this.broadcast("melee_attack", { attackerId, targetId });
      },
      onTargetKilled: (victimId, killerId, weapon, damage) => {
        this.handlePlayerDeath(victimId, killerId, weapon, damage);
      },
    });
    this.setSimulationInterval((deltaTime) => {
      this.zoneManager.updateZone();
      this.botManager?.update(deltaTime);
    }, Math.min(100, runtimeConfig.botThinkIntervalMs));

    ItemSpawner.spawnInitialItems(this.state, runtimeConfig.initialSpawnCount, runtimeConfig.itemSpawnWeights);
    void this.createMatchRecord();

    this.onMessage("move", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;
      const player = this.state.players.get(client.sessionId);
      if (player) {
        const { x, y, z, rotation } = data ?? {};

        if (
          !this.isFiniteNumber(x) ||
          !this.isFiniteNumber(y) ||
          !this.isFiniteNumber(z) ||
          !this.isFiniteNumber(rotation)
        ) {
          console.warn(`[BattleRoom] Ignoring invalid move payload from ${client.sessionId}`);
          return;
        }

        const dx = x - player.x;
        const dz = z - player.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const allowedDistance = this.getAllowedMoveDistance(client.sessionId, Date.now());
        const rawObservedSpeed = this.getObservedMoveSpeed(distance, allowedDistance);
        const allowedSpeedWithGrace = BattleRoom.MAX_MOVE_SPEED * BattleRoom.MOVE_SPEED_GRACE_MULTIPLIER;
        const shouldClampMove = distance > allowedDistance + BattleRoom.MOVE_CLAMP_DISTANCE_MARGIN &&
          rawObservedSpeed > allowedSpeedWithGrace * BattleRoom.MOVE_CLAMP_SPEED_MULTIPLIER;
        const severeMoveAnomaly = shouldClampMove && (
          distance > allowedDistance + BattleRoom.MOVE_ANOMALY_DISTANCE_MARGIN ||
          rawObservedSpeed > allowedSpeedWithGrace * BattleRoom.MOVE_ANOMALY_SPEED_MULTIPLIER
        );
        const observedSpeedForTelemetry = distance > allowedDistance + BattleRoom.MOVE_CLAMP_DISTANCE_MARGIN
          ? rawObservedSpeed
          : Math.min(rawObservedSpeed, allowedSpeedWithGrace);
        this.antiCheatTracker.trackMove(client.sessionId, distance, allowedDistance, observedSpeedForTelemetry, severeMoveAnomaly);

        if (shouldClampMove) {
          if (distance > 0 && allowedDistance > 0) {
            const scale = allowedDistance / distance;
            player.x += dx * scale;
            player.z += dz * scale;
          }

          console.warn(
            `[BattleRoom] Clamped suspicious move from ${player.username}: distance=${distance.toFixed(2)}, allowed=${allowedDistance.toFixed(2)}`
          );
        } else {
          player.x = x;
          player.z = z;
        }

        player.y = y;
        player.rotation = this.normalizeRotation(rotation);
      }
    });

    this.onMessage("shoot", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;

      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      if (player.currentWeapon !== player.rangedWeapon || player.rangedWeapon.length === 0) return;

      const weaponConfig = this.getWeaponConfig(player.currentWeapon);
      if (!weaponConfig || player.ammo <= 0) return;
      if (!this.canProcessShot(client.sessionId, weaponConfig)) {
        this.antiCheatTracker.trackFireRateReject(client.sessionId);
        return;
      }

      const { x, y, z, rx, ry, rz } = data ?? {};
      if (
        !this.isFiniteNumber(x) ||
        !this.isFiniteNumber(y) ||
        !this.isFiniteNumber(z) ||
        !this.isFiniteNumber(rx) ||
        !this.isFiniteNumber(ry) ||
        !this.isFiniteNumber(rz)
      ) {
        console.warn(`[BattleRoom] Ignoring invalid shoot payload from ${client.sessionId}`);
        return;
      }

      player.ammo = Math.max(0, player.ammo - 1);
      this.trackAcceptedShot(client.sessionId);
      this.antiCheatTracker.trackAcceptedShot(
        client.sessionId,
        player.currentWeapon,
        weaponConfig.damage,
        weaponConfig.fireRatePerSecond
      );

      // Broadcast shoot event to other clients
      this.broadcast(
        "shoot",
        {
          clientId: client.sessionId,
          x,
          y,
          z,
          rx: this.normalizeRotation(rx),
          ry: this.normalizeRotation(ry),
          rz: this.normalizeRotation(rz),
        },
        { except: client }
      );
    });

    this.onMessage("switch_weapon", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;

      const slot = data?.slot;
      if (slot !== "melee" && slot !== "ranged") {
        console.warn(`[BattleRoom] Ignoring invalid switch_weapon payload from ${client.sessionId}`);
        return;
      }

      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      if (slot === "melee") {
        if (player.meleeWeapon.length === 0) return;
        player.currentWeapon = player.meleeWeapon;
        return;
      }

      if (player.rangedWeapon.length === 0) return;
      player.currentWeapon = player.rangedWeapon;
    });

    this.onMessage("melee_attack", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;

      const targetId = typeof data?.targetId === "string" ? data.targetId : "";
      if (targetId.length > 0 && !this.state.players.has(targetId)) {
        console.warn(`[BattleRoom] Ignoring invalid melee_attack payload from ${client.sessionId}`);
        return;
      }

      const attacker = this.state.players.get(client.sessionId);
      if (!attacker) return;
      if (attacker.currentWeapon !== attacker.meleeWeapon || !this.isMeleeWeapon(attacker.currentWeapon)) return;
      if (!this.canProcessAction(client.sessionId, BattleRoom.MELEE_COOLDOWN_MS)) return;
      this.antiCheatTracker.trackMeleeAttack(client.sessionId);

      this.broadcast("melee_attack", {
        attackerId: client.sessionId,
        targetId,
      });

      if (targetId.length === 0) return;

      const target = this.state.players.get(targetId);
      if (!target || target.hp <= 0) return;

      const dx = attacker.x - target.x;
      const dz = attacker.z - target.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (!this.isTargetInsideMeleeArc(attacker, target)) {
        this.antiCheatTracker.trackInvalidMelee(client.sessionId);
        console.warn(
          `[BattleRoom] Invalid melee_attack from ${attacker.username} to ${target.username} due to range/angle: ${distance}`
        );
        return;
      }

      target.hp -= BattleRoom.MELEE_DAMAGE;
      if (target.hp <= 0 && !target.isDead) {
        this.handlePlayerDeath(targetId, client.sessionId, attacker.currentWeapon, BattleRoom.MELEE_DAMAGE);
      }
    });

    this.onMessage("hit", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;

      const targetId = data?.targetId;
      if (typeof targetId !== "string" || targetId.length === 0) {
        console.warn(`[BattleRoom] Ignoring invalid hit payload from ${client.sessionId}`);
        return;
      }
      
      const shooter = this.state.players.get(client.sessionId);
      const target = this.state.players.get(targetId);

      if (shooter && target && target.hp > 0) {
        if (shooter.currentWeapon !== shooter.rangedWeapon || shooter.rangedWeapon.length === 0) return;
        const weaponConfig = this.getWeaponConfig(shooter.currentWeapon);
        if (!weaponConfig) return;
        if (!this.consumeAcceptedShot(client.sessionId)) {
          this.antiCheatTracker.trackFireRateReject(client.sessionId);
          return;
        }

        // anticheat Distance Validation
        const dx = shooter.x - target.x;
        const dz = shooter.z - target.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance <= this.maxHitDistance) {
          this.antiCheatTracker.trackAcceptedHit(client.sessionId);
          target.hp -= weaponConfig.damage;
          if (target.hp <= 0 && !target.isDead) {
             this.handlePlayerDeath(targetId, client.sessionId, shooter.currentWeapon, weaponConfig.damage);
          }
        } else {
          this.antiCheatTracker.trackInvalidHit(client.sessionId);
          console.warn(`[BattleRoom] Invalid hit from ${shooter.username} to ${target.username} due to distance: ${distance}`);
        }
      }
    });

    this.onMessage("pickup_progress", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;

      const itemId = data?.itemId;
      const progress = data?.progress;

      if (typeof itemId !== "string" || itemId.length === 0 || !this.isFiniteNumber(progress)) {
        console.warn(`[BattleRoom] Ignoring invalid pickup_progress payload from ${client.sessionId}`);
        return;
      }

      const player = this.state.players.get(client.sessionId);
      const item = this.state.items.get(itemId);
      if (!player || !item) {
        return;
      }

      const dx = player.x - item.x;
      const dz = player.z - item.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance > this.maxItemPickupDistance) {
        this.antiCheatTracker.trackPickupReject(client.sessionId);
        if (item.pickupBy === client.sessionId) {
          item.pickupBy = "";
          item.pickupProgress = 0;
        }
        return;
      }

      const normalizedProgress = this.clamp01(progress);
      if (normalizedProgress <= 0) {
        if (item.pickupBy === client.sessionId) {
          item.pickupBy = "";
          item.pickupProgress = 0;
        }
        return;
      }

      if (item.pickupBy.length > 0 && item.pickupBy !== client.sessionId) {
        return;
      }

      item.pickupBy = client.sessionId;
      item.pickupProgress = normalizedProgress;
    });

    this.onMessage("pickup_item", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;

      const itemId = data?.itemId;
      if (typeof itemId !== "string" || itemId.length === 0) {
        console.warn(`[BattleRoom] Ignoring invalid pickup_item payload from ${client.sessionId}`);
        return;
      }

      const player = this.state.players.get(client.sessionId);
      const item = this.state.items.get(itemId);

      if (!player || !item) {
        return;
      }

      const dx = player.x - item.x;
      const dz = player.z - item.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance > this.maxItemPickupDistance) {
        this.antiCheatTracker.trackPickupReject(client.sessionId);
        console.warn(
          `[BattleRoom] Invalid pickup_item from ${player.username} for ${itemId} due to distance: ${distance}`
        );
        return;
      }

      if (item.type === BattleRoom.VEC_ITEM_TYPE) {
        player.vecCarried += 1;
        const participantId = this.participantBySessionId.get(client.sessionId);
        if (participantId) {
          void (prisma as any).matchParticipant.update({
            where: { id: participantId },
            data: {
              vecCollected: { increment: 1 },
              vecCarried: player.vecCarried,
            },
          }).catch((error: unknown) => console.error("[BattleRoom] Failed to record VEC pickup:", error));
        }
      } else if (item.type === "MedicalKit") {
        player.hp = Math.min(player.hp + this.medicalKitHeal, BattleRoom.MAX_PLAYER_HP);
      } else {
        const weaponConfig = this.getWeaponConfig(item.type);
        if (!weaponConfig) {
          console.warn(`[BattleRoom] Ignoring pickup_item for unsupported weapon type: ${item.type}`);
          return;
        }

        player.rangedWeapon = item.type;
        player.currentWeapon = item.type;
        player.ammo = weaponConfig.maxAmmo;
        this.lastShootAtBySessionId.delete(client.sessionId);
        this.acceptedShotsBySessionId.delete(client.sessionId);
      }

      this.antiCheatTracker.trackPickup(client.sessionId);
      this.state.items.delete(itemId);
      this.broadcast("item_picked", {
        playerId: client.sessionId,
        itemId,
        itemType: item.type,
        fireRate: item.type === "MedicalKit" || item.type === BattleRoom.VEC_ITEM_TYPE ? 0 : 1 / (this.getWeaponConfig(item.type)?.fireRatePerSecond ?? 1),
        maxAmmo: item.type === "MedicalKit" || item.type === BattleRoom.VEC_ITEM_TYPE ? 0 : this.getWeaponConfig(item.type)?.maxAmmo ?? 0,
      });
    });
  }

  onAuth(client: Client, options: any) {
    if (options.accessToken) {
      const decoded = AuthManager.verifyToken(options.accessToken);
      if (decoded) {
        (client as any).username = decoded.username;
        (client as any).userId = decoded.userId;
        return true;
      } else {
        console.error("[BattleRoom] Invalid token");
        return false;
      }
    }
    return true; // allow guest if no token
  }

  async onJoin(client: Client, options: any) {
    if (this.isAirdropMode) {
      const userId = (client as any).userId as string | undefined;
      if (!userId) {
        throw new Error("Play to Airdrop requires an authenticated account.");
      }

      const user = await (prisma as any).user.findUnique({
        where: { id: userId },
        select: { level: true },
      });

      if (!user || user.level < BattleRoom.AIRDROP_MIN_LEVEL) {
        throw new Error(`Play to Airdrop unlocks at level ${BattleRoom.AIRDROP_MIN_LEVEL}.`);
      }
    }

    const player = PlayerSpawner.createPlayer(client, options, this.clients.length);
    player.skinId = await this.getEquippedPlayerSkin(client);
    this.state.players.set(client.sessionId, player);
    this.antiCheatTracker.registerParticipant(client.sessionId);
    void this.createParticipantRecord(client, player.username);
    
    console.log(`[BattleRoom] Client joined: ${client.sessionId} (Username: ${player.username})`);

    this.tryStartMatch();
    this.scheduleBotFillIfNeeded();
  }

  async onLeave(client: Client, code?: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const consented = (code === CloseCode.NORMAL_CLOSURE);

    if (!consented) {
      console.log(`[BattleRoom] Client unexpectedly left: ${player.username}. Waiting 15s for reconnection...`);
      try {
        await this.allowReconnection(client, this.reconnectTimeoutSeconds);
        console.log(`[BattleRoom] Client reconnected: ${player.username}`);
        return;
      } catch (e) {
        console.log(`[BattleRoom] Client failed to reconnect in time: ${player.username}`);
      }
    }

    const username = player.username;

    if (!player.isDead && this.state.matchState === "PLAYING") {
      player.isDead = true;
      this.state.aliveCount = Math.max(0, this.state.aliveCount - 1);
      this.placementBySessionId.set(client.sessionId, Math.max(1, this.state.aliveCount + 1));
    }

    this.state.players.delete(client.sessionId);
    this.lastShootAtBySessionId.delete(client.sessionId);
    this.acceptedShotsBySessionId.delete(client.sessionId);
    this.lastMoveAtBySessionId.delete(client.sessionId);
    this.antiCheatTracker.unregisterParticipant(client.sessionId);
    void this.markParticipantLeft(client.sessionId);
    console.log(`[BattleRoom] Client permanently left: ${username}`);

    if (this.getHumanPlayerCount() === 0) {
      this.clearBotFillTimer();
      const finalStatus = this.state.matchState === "PLAYING" ? "FINISHED" : "ABANDONED";
      if (this.state.matchState === "PLAYING") {
        this.state.matchState = "FINISHED";
      }
      void this.finalizeMatch(finalStatus);
    }

    if (this.state.players.size > 0 && this.state.aliveCount <= 1 && this.state.matchState === "PLAYING") {
      this.finishPlayingMatch();
    }

    if (this.state.matchState !== "PLAYING") {
      this.unlock();
      this.scheduleBotFillIfNeeded();
      console.log(`[BattleRoom] Room unlocked since match hasn't started and a player left.`);
    }
  }

  onDispose() {
    this.clearBotFillTimer();
  }
}

