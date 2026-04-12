import { Client, Room } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { PlayerState } from "../schema/PlayerState";

class BattleRoomState extends Schema {
  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();
}

export class BattleRoom extends Room<{ state: BattleRoomState }> {
  onCreate() {
    this.setState(new BattleRoomState());
    console.log("[BattleRoom] Room created");
  }

  onJoin(client: Client) {
    const player = new PlayerState();
    player.id = client.sessionId;
    player.x = 0;
    player.y = 0;
    player.z = 0;
    player.hp = 100;

    this.state.players.set(client.sessionId, player);
    console.log(`[BattleRoom] Client joined: ${client.sessionId}`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    console.log(`[BattleRoom] Client left: ${client.sessionId}`);
  }
}
