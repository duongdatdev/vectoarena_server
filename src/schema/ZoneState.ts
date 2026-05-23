import { Schema, type } from "@colyseus/schema";

export class ZoneState extends Schema {
  @type("string") currentState: string = "WAITING";
  @type("number") currentCenterX: number = 0;
  @type("number") currentCenterZ: number = 0;
  @type("number") currentRadius: number = 100;

  @type("number") nextCenterX: number = 0;
  @type("number") nextCenterZ: number = 0;
  @type("number") nextRadius: number = 50;

  @type("number") timer: number = 0;
  @type("number") waitTime: number = 10;
  @type("number") shrinkDuration: number = 15;
  @type("number") currentPhase: number = 0;
  @type("number") currentDamagePerSecond: number = 5;
  @type("number") damageMultiplierPerPhase: number = 1.5;
  @type("number") shrinkFactor: number = 0.5;
}
