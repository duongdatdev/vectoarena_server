import { GameState } from "../schema/GameState";
import { ItemState } from "../schema/ItemState";

export class ItemSpawner {
  private static readonly ITEM_TYPES = ["Rifle", "Shotgun", "MedicalKit"];

  private static generateRandomId(seed: number): string {
    return `${Date.now().toString(36)}_${seed.toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
  }

  public static spawnInitialItems(state: GameState, count: number = 20) {
    let spawned = 0;
    let seed = 0;

    while (spawned < count) {
        const item = new ItemState();
        item.id = `item_${this.generateRandomId(seed++)}`;

        if (state.items.has(item.id)) {
          continue;
        }

        item.type = this.ITEM_TYPES[Math.floor(Math.random() * this.ITEM_TYPES.length)];
        
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
}
