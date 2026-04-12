import { Schema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") id!: string;
  @type("number") x!: number;
  @type("number") y!: number;
  @type("number") z!: number;
  @type("number") hp!: number;
}
