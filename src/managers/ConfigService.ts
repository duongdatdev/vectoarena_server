import fs from "fs";
import path from "path";

export type ItemSpawnWeights = {
  Rifle: number;
  Shotgun: number;
  Pistol: number;
  BurstRifle: number;
  Sniper: number;
  HunterSniper: number;
  Launcher: number;
  MachineGun: number;
  Minigun: number;
  BlasterShotgun: number;
  RebelRifle: number;
  MedicalKit: number;
};

export type WeaponConfig = {
  damage: number;
  fireRatePerSecond: number;
  maxAmmo: number;
  maxHitDistance?: number;
};

export type WeaponConfigs = {
  [key: string]: WeaponConfig;
};

export type RuntimeGameConfig = {
  profileCode: string;
  maxPlayers: number;
  initialSpawnCount: number;
  minHumanPlayersToStart: number;
  botCount: number;
  botFillDelayMs: number;
  botMoveSpeed: number;
  botAggroRange: number;
  botMeleeRange: number;
  botAttackCooldownMs: number;
  botThinkIntervalMs: number;
  maxHitDistance: number;
  maxItemPickupDistance: number;
  medicalKitHeal: number;
  reconnectTimeoutSeconds: number;
  weapons: WeaponConfigs;
  itemSpawnWeights: ItemSpawnWeights;
};

export class ConfigService {
  private static cachedConfig: RuntimeGameConfig | null = null;
  private static cacheExpiresAt = 0;
  private static readonly CACHE_TTL_MS = 30_000;
  private static readonly CONFIG_PATH = path.resolve(process.cwd(), "config", "gameplay", "default.json");

  private static getDefaultConfig(): RuntimeGameConfig {
    return {
      profileCode: "fallback_default",
      maxPlayers: 4,
      initialSpawnCount: 20,
      minHumanPlayersToStart: 2,
      botCount: 2,
      botFillDelayMs: 15000,
      botMoveSpeed: 2.6,
      botAggroRange: 18,
      botMeleeRange: 2.5,
      botAttackCooldownMs: 900,
      botThinkIntervalMs: 100,
      maxHitDistance: 60,
      maxItemPickupDistance: 3,
      medicalKitHeal: 30,
      reconnectTimeoutSeconds: 15,
      weapons: {
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
      },
      itemSpawnWeights: {
        Rifle: 3,
        Shotgun: 3,
        Pistol: 4,
        BurstRifle: 2,
        Sniper: 1,
        HunterSniper: 1,
        Launcher: 1,
        MachineGun: 2,
        Minigun: 1,
        BlasterShotgun: 2,
        RebelRifle: 2,
        MedicalKit: 3,
      },
    };
  }

  private static isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
  }

  private static isPositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }

  private static isNonNegativeInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }

  private static readJsonConfig(): Partial<RuntimeGameConfig> | null {
    if (!fs.existsSync(this.CONFIG_PATH)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(this.CONFIG_PATH, "utf8")) as Partial<RuntimeGameConfig>;
    } catch (error) {
      console.error(`[ConfigService] Failed to read config file ${this.CONFIG_PATH}:`, error);
      return null;
    }
  }

  public static async loadActiveConfig(forceRefresh: boolean = false): Promise<RuntimeGameConfig> {
    const now = Date.now();
    if (!forceRefresh && this.cachedConfig && now < this.cacheExpiresAt) {
      return this.cachedConfig;
    }

    const config = this.getDefaultConfig();
    const fileConfig = this.readJsonConfig();

    if (fileConfig) {
      if (typeof fileConfig.profileCode === "string" && fileConfig.profileCode.length > 0) {
        config.profileCode = fileConfig.profileCode;
      }
      if (this.isPositiveInteger(fileConfig.maxPlayers)) {
        config.maxPlayers = fileConfig.maxPlayers;
      }
      if (this.isPositiveInteger(fileConfig.initialSpawnCount)) {
        config.initialSpawnCount = fileConfig.initialSpawnCount;
      }
      if (this.isPositiveInteger(fileConfig.minHumanPlayersToStart)) {
        config.minHumanPlayersToStart = fileConfig.minHumanPlayersToStart;
      }
      if (this.isNonNegativeInteger(fileConfig.botCount)) {
        config.botCount = fileConfig.botCount;
      }
      if (this.isPositiveInteger(fileConfig.botFillDelayMs)) {
        config.botFillDelayMs = fileConfig.botFillDelayMs;
      }
      if (this.isPositiveNumber(fileConfig.botMoveSpeed)) {
        config.botMoveSpeed = fileConfig.botMoveSpeed;
      }
      if (this.isPositiveNumber(fileConfig.botAggroRange)) {
        config.botAggroRange = fileConfig.botAggroRange;
      }
      if (this.isPositiveNumber(fileConfig.botMeleeRange)) {
        config.botMeleeRange = fileConfig.botMeleeRange;
      }
      if (this.isPositiveInteger(fileConfig.botAttackCooldownMs)) {
        config.botAttackCooldownMs = fileConfig.botAttackCooldownMs;
      }
      if (this.isPositiveInteger(fileConfig.botThinkIntervalMs)) {
        config.botThinkIntervalMs = fileConfig.botThinkIntervalMs;
      }
      if (this.isPositiveNumber(fileConfig.maxHitDistance)) {
        config.maxHitDistance = fileConfig.maxHitDistance;
      }
      if (this.isPositiveNumber(fileConfig.maxItemPickupDistance)) {
        config.maxItemPickupDistance = fileConfig.maxItemPickupDistance;
      }
      if (this.isPositiveInteger(fileConfig.medicalKitHeal)) {
        config.medicalKitHeal = fileConfig.medicalKitHeal;
      }
      if (this.isPositiveInteger(fileConfig.reconnectTimeoutSeconds)) {
        config.reconnectTimeoutSeconds = fileConfig.reconnectTimeoutSeconds;
      }
      if (fileConfig.weapons) {
        for (const key of Object.keys(config.weapons)) {
          if (fileConfig.weapons[key]) {
            this.mergeWeaponConfig(config.weapons[key], fileConfig.weapons[key]);
          }
        }
      }
      if (fileConfig.itemSpawnWeights) {
        const weights = fileConfig.itemSpawnWeights;
        for (const key of Object.keys(config.itemSpawnWeights) as Array<keyof ItemSpawnWeights>) {
          if (this.isPositiveInteger(weights[key])) {
            config.itemSpawnWeights[key] = weights[key];
          }
        }
      }
    }

    this.cachedConfig = config;
    this.cacheExpiresAt = now + this.CACHE_TTL_MS;

    return config;
  }

  private static mergeWeaponConfig(target: WeaponConfig, source?: Partial<WeaponConfig>): void {
    if (!source) return;

    if (this.isPositiveInteger(source.damage)) {
      target.damage = source.damage;
    }
    if (this.isPositiveNumber(source.fireRatePerSecond)) {
      target.fireRatePerSecond = source.fireRatePerSecond;
    }
    if (this.isPositiveInteger(source.maxAmmo)) {
      target.maxAmmo = source.maxAmmo;
    }
    if (this.isPositiveNumber(source.maxHitDistance)) {
      target.maxHitDistance = source.maxHitDistance;
    }
  }
}
