import { GameState } from "../schema/GameState";
import { ItemState } from "../schema/ItemState";
import { ItemSpawnWeights } from "./ConfigService";

export class ItemSpawner {
  private static readonly ITEM_TYPES = ["Rifle", "Shotgun", "MedicalKit"];

  private static generateRandomId(seed: number): string {
    return `${Date.now().toString(36)}_${seed.toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private static pickRandomItemType(weights?: ItemSpawnWeights): string {
    if (!weights) {
      return this.ITEM_TYPES[Math.floor(Math.random() * this.ITEM_TYPES.length)];
    }

    const weightedPool: Array<{ type: string; weight: number }> = [];
    for (const key of Object.keys(weights) as Array<keyof ItemSpawnWeights>) {
      const w = Math.max(0, weights[key]);
      if (w > 0) {
        weightedPool.push({ type: key, weight: w });
      }
    }

    const totalWeight = weightedPool.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) {
      return this.ITEM_TYPES[Math.floor(Math.random() * this.ITEM_TYPES.length)];
    }

    let roll = Math.random() * totalWeight;
    for (const item of weightedPool) {
      roll -= item.weight;
      if (roll <= 0) {
        return item.type;
      }
    }

    return weightedPool[weightedPool.length - 1].type;
  }

  public static spawnInitialItems(state: GameState, count: number = 20, weights?: ItemSpawnWeights) {
    let spawned = 0;
    let seed = 0;

    while (spawned < count) {
        const item = new ItemState();
        item.id = `item_${this.generateRandomId(seed++)}`;

        if (state.items.has(item.id)) {
          continue;
        }

        item.type = this.pickRandomItemType(weights);
        
        // x -47.5 to 47.7
        item.x = -47.5 + Math.random() * (47.7 - (-47.5));
        item.y = 0.1;
        // z -47.7 to 47.5
        item.z = -47.7 + Math.random() * (47.5 - (-47.7));

        state.items.set(item.id, item);
        spawned += 1;
    }
    
    console.log(`[ItemSpawner] Spawned ${spawned} initial items. Total in state: ${state.items.size}`);
  }

  public static spawnItemAt(state: GameState, type: string, x: number, z: number) {
    const item = new ItemState();
    item.id = `item_${this.generateRandomId(Date.now() % 1000)}`;
    item.type = type;
    item.x = x;
    item.y = 0.1;
    item.z = z;

    state.items.set(item.id, item);
    console.log(`[ItemSpawner] Dropped item ${type} at (${x}, ${z})`);
  }
}
