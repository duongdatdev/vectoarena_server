export type PlayerSkinCatalogItem = {
  id: string;
  displayName: string;
  price: number;
};

export const DEFAULT_PLAYER_SKIN_ID = "Female01";

export const PLAYER_SKIN_CATALOG: PlayerSkinCatalogItem[] = [
  { id: "Female01", displayName: "Vecto Hero", price: 0 },
  { id: "Female02", displayName: "Nova Runner", price: 500 },
  { id: "CorposFemale", displayName: "Corpos Agent", price: 800 },
  { id: "AssassinFemale", displayName: "Shadow Assassin", price: 1200 },
];

export function getPlayerSkinById(skinId: string): PlayerSkinCatalogItem | null {
  return PLAYER_SKIN_CATALOG.find((skin) => skin.id === skinId) ?? null;
}
