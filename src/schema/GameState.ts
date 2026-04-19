import { Schema, type, MapSchema } from "@colyseus/schema";
import { PlayerState } from "./PlayerState";
import { ZoneState } from "./ZoneState";

export class GameState extends Schema {
  @type("string") matchState: string = "WAITING";

  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();

  @type(ZoneState)
  zone = new ZoneState();
}
