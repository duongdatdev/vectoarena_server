import { GameState } from "../schema/GameState";
import { PlayerState } from "../schema/PlayerState";
import { PlayerSpawner } from "./PlayerSpawner";

type BotBrain = {
  destinationX: number;
  destinationZ: number;
  nextAttackAt: number;
};

export type BotManagerOptions = {
  state: GameState;
  botCount: number;
  moveSpeed: number;
  aggroRange: number;
  meleeRange: number;
  meleeDamage: number;
  attackCooldownMs: number;
  meleeWeapon: string;
  onMeleeAttack: (attackerId: string, targetId: string) => void;
  onTargetKilled: (victimId: string, killerId: string, weapon: string, damage: number) => void;
};

export class BotManager {
  private static readonly BOT_ID_PREFIX = "bot_";
  private static readonly MAP_MIN_X = -47.5;
  private static readonly MAP_MAX_X = 47.5;
  private static readonly MAP_MIN_Z = -47.5;
  private static readonly MAP_MAX_Z = 47.5;
  private static readonly SPAWN_Y = 0.05;
  private static readonly WAYPOINT_REACHED_DISTANCE = 0.75;
  private static readonly MAX_DELTA_TIME_MS = 250;

  private readonly brains = new Map<string, BotBrain>();

  public constructor(private readonly options: BotManagerOptions) {}

  public static isBotId(id: string): boolean {
    return id.startsWith(BotManager.BOT_ID_PREFIX);
  }

  public spawnBots(count: number = this.options.botCount): number {
    const desiredCount = Math.max(0, Math.min(count, this.options.botCount));
    let spawnedCount = 0;

    for (let i = 1; spawnedCount < desiredCount; i += 1) {
      const botId = `${BotManager.BOT_ID_PREFIX}${i}`;
      if (this.options.state.players.has(botId)) {
        continue;
      }

      const spawnPoint = this.randomMapPoint();
      const bot = new PlayerState();
      bot.id = botId;
      bot.username = `Bot ${i}`;
      bot.x = spawnPoint.x;
      bot.y = BotManager.SPAWN_Y;
      bot.z = spawnPoint.z;
      bot.rotation = Math.random() * 360;
      bot.hp = 100;
      bot.currentWeapon = this.options.meleeWeapon || PlayerSpawner.DEFAULT_MELEE_WEAPON;
      bot.meleeWeapon = this.options.meleeWeapon || PlayerSpawner.DEFAULT_MELEE_WEAPON;
      bot.rangedWeapon = "";
      bot.ammo = 0;
      bot.kills = 0;
      bot.isDead = false;
      bot.skinId = i % 2 === 0 ? "Female02" : "Female01";
      bot.vecCarried = 0;

      this.options.state.players.set(botId, bot);
      this.brains.set(botId, this.createBrain());
      spawnedCount += 1;
    }

    return spawnedCount;
  }

  public update(deltaTimeMs: number): void {
    const deltaSeconds = Math.max(0, Math.min(deltaTimeMs, BotManager.MAX_DELTA_TIME_MS)) / 1000;
    if (deltaSeconds <= 0) return;

    for (const [botId, brain] of this.brains) {
      const bot = this.options.state.players.get(botId);
      if (!bot || bot.isDead || bot.hp <= 0) {
        continue;
      }

      const target = this.findNearestTarget(botId, bot);
      const shouldChase = target !== null && (target.distance <= this.options.aggroRange || !this.hasAliveHumanPlayer());

      if (shouldChase && target) {
        this.moveToward(bot, target.player.x, target.player.z, deltaSeconds);
        this.tryAttack(botId, bot, target.id, target.player, brain);
        continue;
      }

      const waypointDistance = this.distance(bot.x, bot.z, brain.destinationX, brain.destinationZ);
      if (waypointDistance <= BotManager.WAYPOINT_REACHED_DISTANCE) {
        const point = this.randomMapPoint();
        brain.destinationX = point.x;
        brain.destinationZ = point.z;
      }

      this.moveToward(bot, brain.destinationX, brain.destinationZ, deltaSeconds);
    }
  }

  private createBrain(): BotBrain {
    const point = this.randomMapPoint();
    return {
      destinationX: point.x,
      destinationZ: point.z,
      nextAttackAt: 0,
    };
  }

  private findNearestTarget(botId: string, bot: PlayerState): { id: string; player: PlayerState; distance: number } | null {
    let nearest: { id: string; player: PlayerState; distance: number } | null = null;

    this.options.state.players.forEach((player, id) => {
      if (id === botId || player.isDead || player.hp <= 0) {
        return;
      }

      const distance = this.distance(bot.x, bot.z, player.x, player.z);
      if (!nearest || distance < nearest.distance) {
        nearest = { id, player, distance };
      }
    });

    return nearest;
  }

  private hasAliveHumanPlayer(): boolean {
    let hasAliveHuman = false;

    this.options.state.players.forEach((player, id) => {
      if (!BotManager.isBotId(id) && !player.isDead && player.hp > 0) {
        hasAliveHuman = true;
      }
    });

    return hasAliveHuman;
  }

  private moveToward(bot: PlayerState, destinationX: number, destinationZ: number, deltaSeconds: number): void {
    const dx = destinationX - bot.x;
    const dz = destinationZ - bot.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance <= 0.001) {
      return;
    }

    const step = Math.min(distance, this.options.moveSpeed * deltaSeconds);
    const directionX = dx / distance;
    const directionZ = dz / distance;

    bot.x = this.clamp(bot.x + directionX * step, BotManager.MAP_MIN_X, BotManager.MAP_MAX_X);
    bot.z = this.clamp(bot.z + directionZ * step, BotManager.MAP_MIN_Z, BotManager.MAP_MAX_Z);
    bot.y = BotManager.SPAWN_Y;
    bot.rotation = this.normalizeRotation((Math.atan2(directionX, directionZ) * 180) / Math.PI);
  }

  private tryAttack(
    botId: string,
    bot: PlayerState,
    targetId: string,
    target: PlayerState,
    brain: BotBrain
  ): void {
    const distance = this.distance(bot.x, bot.z, target.x, target.z);
    if (distance > this.options.meleeRange) {
      return;
    }

    const now = Date.now();
    if (now < brain.nextAttackAt) {
      return;
    }

    brain.nextAttackAt = now + this.options.attackCooldownMs;
    this.faceTarget(bot, target);
    this.options.onMeleeAttack(botId, targetId);

    target.hp = Math.max(0, target.hp - this.options.meleeDamage);
    if (target.hp <= 0 && !target.isDead) {
      this.options.onTargetKilled(targetId, botId, bot.currentWeapon, this.options.meleeDamage);
    }
  }

  private faceTarget(bot: PlayerState, target: PlayerState): void {
    const dx = target.x - bot.x;
    const dz = target.z - bot.z;
    if (Math.abs(dx) <= 0.001 && Math.abs(dz) <= 0.001) {
      return;
    }

    bot.rotation = this.normalizeRotation((Math.atan2(dx, dz) * 180) / Math.PI);
  }

  private randomMapPoint(): { x: number; z: number } {
    return {
      x: BotManager.MAP_MIN_X + Math.random() * (BotManager.MAP_MAX_X - BotManager.MAP_MIN_X),
      z: BotManager.MAP_MIN_Z + Math.random() * (BotManager.MAP_MAX_Z - BotManager.MAP_MIN_Z),
    };
  }

  private distance(ax: number, az: number, bx: number, bz: number): number {
    const dx = bx - ax;
    const dz = bz - az;
    return Math.sqrt(dx * dx + dz * dz);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private normalizeRotation(value: number): number {
    const normalized = value % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }
}
