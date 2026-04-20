import { Client } from "colyseus";
import { PlayerState } from "../schema/PlayerState";

export class PlayerSpawner {
  private static readonly spawnPoints = [
    { x: -10, y: 0.05, z: 0, rot: 90 },
    { x: 10, y: 0.05, z: 0, rot: -90 }
  ];

  public static createPlayer(client: Client, options: any, currentClientCount: number): PlayerState {
    const playerIndex = currentClientCount - 1;
    const spawnPoint = this.spawnPoints[playerIndex % this.spawnPoints.length];

    const player = new PlayerState();
    player.id = client.sessionId;
    player.username = (client as any).username || options.username || `Guest_${client.sessionId.substring(0, 5)}`;
    player.x = spawnPoint.x;
    player.y = spawnPoint.y;
    player.z = spawnPoint.z;
    player.rotation = spawnPoint.rot;
    player.hp = 100;

    return player;
  }
}
