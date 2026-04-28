import { Client, Room, CloseCode } from "colyseus";
import { GameState } from "../schema/GameState";
import { ZoneManager } from "../managers/ZoneManager";
import { AuthManager } from "../managers/AuthManager";
import { PlayerSpawner } from "../managers/PlayerSpawner";
import { ItemSpawner } from "../managers/ItemSpawner";
import { ConfigService } from "../managers/ConfigService";
import prisma from "../database/prisma";

export class BattleRoom extends Room<{ state: GameState }> {
  private zoneManager!: ZoneManager;
  private static readonly MAX_PLAYER_HP = 100;
  private maxItemPickupDistance = 3;
  private medicalKitHeal = 30;
  private maxHitDistance = 60;
  private reconnectTimeoutSeconds = 15;
  private hitDamage = 10;
  private matchRecordId: string | null = null;
  private participantBySessionId = new Map<string, string>();

  private async createMatchRecord(): Promise<void> {
    try {
      const match = await (prisma as any).match.create({
        data: {
          roomCode: this.roomId,
          mode: "BATTLE",
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

  private async finalizeMatch(status: "FINISHED" | "ABANDONED"): Promise<void> {
    if (!this.matchRecordId) return;
    try {
      await (prisma as any).match.update({
        where: { id: this.matchRecordId },
        data: {
          status,
          endedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("[BattleRoom] Failed to finalize match:", error);
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

  private async recordKillEvent(killerSessionId: string, victimSessionId: string): Promise<void> {
    if (!this.matchRecordId) return;

    const killerParticipantId = this.participantBySessionId.get(killerSessionId) ?? null;
    const victimParticipantId = this.participantBySessionId.get(victimSessionId);
    if (!victimParticipantId) return;

    try {
      await (prisma as any).killEvent.create({
        data: {
          matchId: this.matchRecordId,
          killerParticipantId,
          victimParticipantId,
          damage: this.hitDamage,
          weapon: "RIFLE",
          deathCause: "PLAYER",
        },
      });

      if (killerParticipantId) {
        await (prisma as any).matchParticipant.update({
          where: { id: killerParticipantId },
          data: {
            kills: { increment: 1 },
            damageDealt: { increment: this.hitDamage },
          },
        });
      }

      await (prisma as any).matchParticipant.update({
        where: { id: victimParticipantId },
        data: {
          deaths: { increment: 1 },
          damageTaken: { increment: this.hitDamage },
        },
      });
    } catch (error) {
      console.error("[BattleRoom] Failed to record kill event:", error);
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

  async onCreate() {
    const runtimeConfig = await ConfigService.loadActiveConfig();

    this.maxClients = runtimeConfig.maxPlayers;
    this.maxItemPickupDistance = runtimeConfig.maxItemPickupDistance;
    this.medicalKitHeal = runtimeConfig.medicalKitHeal;
    this.maxHitDistance = runtimeConfig.maxHitDistance;
    this.reconnectTimeoutSeconds = runtimeConfig.reconnectTimeoutSeconds;
    this.hitDamage = runtimeConfig.rifleDamage;

    this.setState(new GameState());
    console.log(
      `[BattleRoom] Room created with config ${runtimeConfig.profileCode} (maxPlayers=${this.maxClients}, spawn=${runtimeConfig.initialSpawnCount})`
    );

    this.zoneManager = new ZoneManager(this.state);
    this.zoneManager.initializeZone();
    this.setSimulationInterval(() => this.zoneManager.updateZone(), 100);

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

        player.x = x;
        player.y = y;
        player.z = z;
        player.rotation = this.normalizeRotation(rotation);
      }
    });

    this.onMessage("shoot", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;

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
        // anticheat Distance Validation
        const dx = shooter.x - target.x;
        const dz = shooter.z - target.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        if (distance <= this.maxHitDistance) {
          target.hp -= this.hitDamage;
          if (target.hp < 0) target.hp = 0;
          
          if (target.hp === 0) {
             console.log(`[BattleRoom] Player ${target.username} died by ${shooter.username}.`);
             void this.recordKillEvent(client.sessionId, targetId);
          }
        } else {
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
        console.warn(
          `[BattleRoom] Invalid pickup_item from ${player.username} for ${itemId} due to distance: ${distance}`
        );
        return;
      }

      if (item.type === "MedicalKit") {
        player.hp = Math.min(player.hp + this.medicalKitHeal, BattleRoom.MAX_PLAYER_HP);
      }

      this.state.items.delete(itemId);
      this.broadcast("item_picked", {
        playerId: client.sessionId,
        itemId,
        itemType: item.type,
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

  onJoin(client: Client, options: any) {
    const player = PlayerSpawner.createPlayer(client, options, this.clients.length);
    this.state.players.set(client.sessionId, player);
    void this.createParticipantRecord(client, player.username);
    
    console.log(`[BattleRoom] Client joined: ${client.sessionId} (Username: ${player.username})`);

    if (this.clients.length === this.maxClients) {
      this.lock();
      this.state.matchState = "PLAYING";
      this.broadcast("GAME_START");
      void this.setMatchPlaying();
    }
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
    this.state.players.delete(client.sessionId);
    void this.markParticipantLeft(client.sessionId);
    this.participantBySessionId.delete(client.sessionId);
    console.log(`[BattleRoom] Client permanently left: ${username}`);

    if (this.state.players.size === 0) {
      const finalStatus = this.state.matchState === "PLAYING" ? "FINISHED" : "ABANDONED";
      void this.finalizeMatch(finalStatus);
    }

    if (this.state.matchState !== "PLAYING") {
      this.unlock();
      console.log(`[BattleRoom] Room unlocked since match hasn't started and a player left.`);
    }
  }
}

