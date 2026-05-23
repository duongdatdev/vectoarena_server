export type SkinOwnershipType = "OFFCHAIN" | "NFT";
export type SkinCurrencyType = "COIN" | "VEC";

export type SkinNftMapping = {
  chainId: number | null;
  contractAddress: string | null;
  tokenId: string | null;
  collectionKey: string;
};

export type PlayerSkinCatalogItem = {
  id: string;
  displayName: string;
  prefabKey: string;
  price: number;
  currencyType: SkinCurrencyType;
  ownershipType?: SkinOwnershipType;
  nft?: SkinNftMapping;
};

export const DEFAULT_PLAYER_SKIN_ID = "Female01";

export const PLAYER_SKIN_CATALOG: PlayerSkinCatalogItem[] = [
  {
    id: "Female01",
    displayName: "Vecto Hero",
    prefabKey: "CharacterSkins/Female01/Char_Female01",
    price: 0,
    currencyType: "COIN",
    ownershipType: "OFFCHAIN",
  },
  {
    id: "Female02",
    displayName: "Nova Runner",
    prefabKey: "CharacterSkins/Female02/Char_Female02",
    price: 500,
    currencyType: "COIN",
    ownershipType: "OFFCHAIN",
  },
  {
    id: "CorposFemale",
    displayName: "Corpos Agent",
    prefabKey: "CharacterSkins/CorposFemale/Char_CorposFemale",
    price: 800,
    currencyType: "COIN",
    ownershipType: "OFFCHAIN",
  },
  {
    id: "AssassinFemale",
    displayName: "Shadow Assassin",
    prefabKey: "CharacterSkins/AssassinFemale/Char_AssassinFemale",
    price: 1200,
    currencyType: "COIN",
    ownershipType: "OFFCHAIN",
  },
  {
    id: "CyberBunny",
    displayName: "Cyber Bunny",
    prefabKey: "CharacterSkins/CyberBunny/Char_CyberBunny",
    price: 35,
    currencyType: "VEC",
    ownershipType: "NFT",
    nft: {
      chainId: null,
      contractAddress: null,
      tokenId: null,
      collectionKey: "vectoarena-genesis-skins",
    },
  },
  {
    id: "Iceking",
    displayName: "Ice King",
    prefabKey: "CharacterSkins/Iceking/Char_Iceking",
    price: 45,
    currencyType: "VEC",
    ownershipType: "NFT",
    nft: {
      chainId: null,
      contractAddress: null,
      tokenId: null,
      collectionKey: "vectoarena-genesis-skins",
    },
  },
  {
    id: "Anubis",
    displayName: "Anubis",
    prefabKey: "CharacterSkins/Anubis/Char_Anubis",
    price: 55,
    currencyType: "VEC",
    ownershipType: "NFT",
    nft: {
      chainId: null,
      contractAddress: null,
      tokenId: null,
      collectionKey: "vectoarena-genesis-skins",
    },
  },
  {
    id: "GearedApe",
    displayName: "Geared Ape",
    prefabKey: "CharacterSkins/GearedApe/Char_GearedApe",
    price: 40,
    currencyType: "VEC",
    ownershipType: "NFT",
    nft: {
      chainId: null,
      contractAddress: null,
      tokenId: null,
      collectionKey: "vectoarena-genesis-skins",
    },
  },
];

export function getPlayerSkinById(skinId: string): PlayerSkinCatalogItem | null {
  return PLAYER_SKIN_CATALOG.find((skin) => skin.id === skinId) ?? null;
}
