import { Client, Room } from "colyseus";
import { GameState } from "../schema/GameState";
import { PlayerState } from "../schema/PlayerState";

export class BattleRoom extends Room<{ state: GameState }> {
  onCreate() {
    this.maxClients = 2;
    this.setState(new GameState());
    console.log("[BattleRoom] Room created");

    this.onMessage("move", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.x = data.x;
        player.y = data.y;
        player.z = data.z;
      }
    });

    this.onMessage("shoot", (client, data) => {
      if (this.state.matchState !== "PLAYING") return;
      // Broadcast shoot event to other clients
      this.broadcast("shoot", { clientId: client.sessionId, ...data }, { except: client });
    });
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

    if (this.clients.length === this.maxClients) {
      this.lock();
      this.state.matchState = "PLAYING";
      this.broadcast("GAME_START");
    }
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    console.log(`[BattleRoom] Client left: ${client.sessionId}`);
  }
}
