import fs from "fs";
import path from "path";

export type ItemSpawnWeights = {
  Rifle: number;
  Shotgun: number;
  MedicalKit: number;
};

export type RuntimeGameConfig = {
  profileCode: string;
  maxPlayers: number;
  initialSpawnCount: number;
  maxHitDistance: number;
  maxItemPickupDistance: number;
  medicalKitHeal: number;
  reconnectTimeoutSeconds: number;
  rifleDamage: number;
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
      maxPlayers: 2,
      initialSpawnCount: 20,
      maxHitDistance: 60,
      maxItemPickupDistance: 3,
      medicalKitHeal: 30,
      reconnectTimeoutSeconds: 15,
      rifleDamage: 10,
      itemSpawnWeights: {
        Rifle: 1,
        Shotgun: 1,
        MedicalKit: 1,
      },
    };
  }

  private static isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
  }

  private static isPositiveNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
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
      if (this.isPositiveInteger(fileConfig.rifleDamage)) {
        config.rifleDamage = fileConfig.rifleDamage;
      }
      if (fileConfig.itemSpawnWeights) {
        const weights = fileConfig.itemSpawnWeights;
        if (this.isPositiveInteger(weights.Rifle)) config.itemSpawnWeights.Rifle = weights.Rifle;
        if (this.isPositiveInteger(weights.Shotgun)) config.itemSpawnWeights.Shotgun = weights.Shotgun;
        if (this.isPositiveInteger(weights.MedicalKit)) config.itemSpawnWeights.MedicalKit = weights.MedicalKit;
      }
    }

    this.cachedConfig = config;
    this.cacheExpiresAt = now + this.CACHE_TTL_MS;

    return config;
  }
}
