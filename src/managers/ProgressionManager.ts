export interface ProgressionState {
  level: number;
  xp: number;
}

export interface ProgressionResult extends ProgressionState {
  xpToNextLevel: number;
  xpProgress: number;
  levelsGained: number;
}

export interface MatchXpInput {
  maxPlayers: number;
  placement: number;
  kills: number;
  isWinner: boolean;
}

export class ProgressionManager {
  static readonly MAX_LEVEL = 100;
  static readonly MATCH_COMPLETION_XP = 25;
  static readonly XP_PER_KILL = 20;
  static readonly VICTORY_XP = 50;
  static readonly PLACEMENT_XP_MULTIPLIER = 10;

  static getXpNeededForLevel(level: number): number {
    if (level <= 4) return 100;
    if (level <= 6) return 200;
    if (level === 7) return 400;
    if (level === 8) return 800;
    if (level === 9) return 1500;
    if (level === 10) return 3000;
    if (level === 11) return 5000;
    if (level === 12) return 7000;
    return 9000;
  }

  static addXp(state: ProgressionState, amount: number): ProgressionResult {
    let level = Math.max(1, Math.floor(state.level));
    let xp = Math.max(0, Math.floor(state.xp)) + Math.max(0, Math.floor(amount));
    const startLevel = level;

    while (level < ProgressionManager.MAX_LEVEL) {
      const needed = ProgressionManager.getXpNeededForLevel(level);
      if (xp < needed) break;

      xp -= needed;
      level += 1;
    }

    if (level >= ProgressionManager.MAX_LEVEL) {
      level = ProgressionManager.MAX_LEVEL;
      xp = 0;
    }

    return ProgressionManager.buildResult(level, xp, level - startLevel);
  }

  static buildResult(level: number, xp: number, levelsGained = 0): ProgressionResult {
    const normalizedLevel = Math.max(1, Math.min(ProgressionManager.MAX_LEVEL, Math.floor(level)));
    const normalizedXp = normalizedLevel >= ProgressionManager.MAX_LEVEL ? 0 : Math.max(0, Math.floor(xp));
    const xpToNextLevel = normalizedLevel >= ProgressionManager.MAX_LEVEL
      ? 0
      : ProgressionManager.getXpNeededForLevel(normalizedLevel);

    return {
      level: normalizedLevel,
      xp: normalizedXp,
      xpToNextLevel,
      xpProgress: xpToNextLevel <= 0 ? 1 : Math.min(1, normalizedXp / xpToNextLevel),
      levelsGained,
    };
  }

  static calculateMatchXp(input: MatchXpInput): number {
    const maxPlayers = Math.max(1, Math.floor(input.maxPlayers));
    const placement = Math.max(1, Math.floor(input.placement));
    const kills = Math.max(0, Math.floor(input.kills));
    const placementBonus = Math.max(0, (maxPlayers - placement + 1) * ProgressionManager.PLACEMENT_XP_MULTIPLIER);

    return ProgressionManager.MATCH_COMPLETION_XP
      + kills * ProgressionManager.XP_PER_KILL
      + (input.isWinner ? ProgressionManager.VICTORY_XP : 0)
      + placementBonus;
  }
}
