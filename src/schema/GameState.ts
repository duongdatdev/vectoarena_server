import { Schema, type, MapSchema } from "@colyseus/schema";
import { PlayerState } from "./PlayerState";

export class GameState extends Schema {
  @type("string") matchState: string = "WAITING";

  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();
}
