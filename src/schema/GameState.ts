import { Schema, type, MapSchema } from "@colyseus/schema";
import { PlayerState } from "./PlayerState";
import { ZoneState } from "./ZoneState";
import { ItemState } from "./ItemState";

export class GameState extends Schema {
  @type("string") matchState: string = "WAITING";
  @type("number") aliveCount: number = 0;

  @type({ map: PlayerState })
  players = new MapSchema<PlayerState>();

  @type(ZoneState)
  zone = new ZoneState();

  @type({ map: ItemState })
  items = new MapSchema<ItemState>();
}
