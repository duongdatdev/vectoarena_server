import { Client, Room, CloseCode } from "colyseus";
import { GameState } from "../schema/GameState";
import { ZoneManager } from "../managers/ZoneManager";
import { AuthManager } from "../managers/AuthManager";
import { PlayerSpawner } from "../managers/PlayerSpawner";
import { ItemSpawner } from "../managers/ItemSpawner";

export class BattleRoom extends Room<{ state: GameState }> {
  private zoneManager!: ZoneManager;
  private static readonly MAX_ITEM_PICKUP_DISTANCE = 3;
  private static readonly MAX_PLAYER_HP = 100;
  private static readonly MEDICAL_KIT_HEAL = 30;

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

  onCreate() {
    this.maxClients = 2;
    this.setState(new GameState());
    console.log("[BattleRoom] Room created");

    this.zoneManager = new ZoneManager(this.state);
    this.zoneManager.initializeZone();
    this.setSimulationInterval(() => this.zoneManager.updateZone(), 100);

    ItemSpawner.spawnInitialItems(this.state, 20);

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
        
        // 60 units is our max threshold.
        if (distance <= 60) {
          target.hp -= 10;
          if (target.hp < 0) target.hp = 0;
          
          if (target.hp === 0) {
             console.log(`[BattleRoom] Player ${target.username} died by ${shooter.username}.`);
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

      if (distance > BattleRoom.MAX_ITEM_PICKUP_DISTANCE) {
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

      if (distance > BattleRoom.MAX_ITEM_PICKUP_DISTANCE) {
        console.warn(
          `[BattleRoom] Invalid pickup_item from ${player.username} for ${itemId} due to distance: ${distance}`
        );
        return;
      }

      if (item.type === "MedicalKit") {
        player.hp = Math.min(player.hp + BattleRoom.MEDICAL_KIT_HEAL, BattleRoom.MAX_PLAYER_HP);
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

