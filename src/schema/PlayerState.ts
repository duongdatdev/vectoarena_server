import { Schema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") id!: string;
  @type("string") username!: string;
  @type("number") x!: number;
  @type("number") y!: number;
  @type("number") z!: number;
  @type("number") rotation!: number;
  @type("number") hp!: number;
  @type("string") currentWeapon: string = "";
  @type("number") ammo: number = 0;
  @type("string") meleeWeapon: string = "";
  @type("string") rangedWeapon: string = "";
  @type("number") kills: number = 0;
  @type("boolean") isDead: boolean = false;
  @type("string") skinId: string = "Female01";
}
