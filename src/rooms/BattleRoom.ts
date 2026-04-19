import { Client, Room, CloseCode } from "colyseus";
import { GameState } from "../schema/GameState";
import { PlayerState } from "../schema/PlayerState";
import { ZoneState } from "../schema/ZoneState";
import jwt from "jsonwebtoken";

const jwtSecret = process.env.JWT_SECRET || "supersecretkey";

export class BattleRoom extends Room<{ state: GameState }> {
  private zoneStartCenterX = 0;
  private zoneStartCenterZ = 0;
  private zoneStartRadius = 100;

  onCreate() {
    this.maxClients = 2;
    this.setState(new GameState());
    console.log("[BattleRoom] Room created");

    this.initializeZone();
    this.setSimulationInterval(() => this.updateZone(), 100);

    const spawnPoints = [
      { x: -10, y: 1, z: 0, rot: 90 },
      { x: 10, y: 1, z: 0, rot: -90 }
    ];

    this.onMessage("move", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.x = data.x;
        player.y = data.y;
        player.z = data.z;
        player.rotation = data.rotation;
      }
    });

    this.onMessage("shoot", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;
      // Broadcast shoot event to other clients
      this.broadcast("shoot", { clientId: client.sessionId, ...data }, { except: client });
    });
  }

  private initializeZone() {
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

  private updateZone() {
    const zone = this.state.zone;
    if (this.state.matchState !== "PLAYING" || zone.currentState === "MATCHENDED") {
      return;
    }

    zone.timer += 0.1;

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

  onAuth(client: Client, options: any) {
    if (options.accessToken) {
      try {
        const decoded = jwt.verify(options.accessToken, jwtSecret) as { userId: string; username: string };
        (client as any).username = decoded.username;
        return true;
      } catch (e) {
        console.error("[BattleRoom] Invalid token");
        return false;
      }
    }
    return true; // allow guest if no token? maybe and handle username differently
  }

  onJoin(client: Client, options: any) {
    const spawnPoints = [
      { x: -10, y: 0.05, z: 0, rot: 90 },
      { x: 10, y: 0.05, z: 0, rot: -90 }
    ];

    const playerIndex = this.clients.length - 1;
    const spawnPoint = spawnPoints[playerIndex % spawnPoints.length];

    const player = new PlayerState();
    player.id = client.sessionId;
    player.username = (client as any).username || options.username || `Guest_${client.sessionId.substring(0, 5)}`;
    player.x = spawnPoint.x;
    player.y = spawnPoint.y;
    player.z = spawnPoint.z;
    player.rotation = spawnPoint.rot;
    player.hp = 100;

    this.state.players.set(client.sessionId, player);
    console.log(`[BattleRoom] Client joined: ${client.sessionId} (Username: ${player.username})`);

    if (this.clients.length === this.maxClients) {
      this.lock();
      this.state.matchState = "PLAYING";
      this.broadcast("GAME_START");
    }
  }

  async onLeave(client: Client, code?: number) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const consented = (code === CloseCode.NORMAL_CLOSURE);

    if (!consented) {
      console.log(`[BattleRoom] Client unexpectedly left: ${player.username}. Waiting 15s for reconnection...`);
      try {
        await this.allowReconnection(client, 15);
        console.log(`[BattleRoom] Client reconnected: ${player.username}`);
        return;
      } catch (e) {
        console.log(`[BattleRoom] Client failed to reconnect in time: ${player.username}`);
      }
    }

    const username = player.username;
    this.state.players.delete(client.sessionId);
    console.log(`[BattleRoom] Client permanently left: ${username}`);

    if (this.state.matchState !== "PLAYING") {
      this.unlock();
      console.log(`[BattleRoom] Room unlocked since match hasn't started and a player left.`);
    }
  }
}
