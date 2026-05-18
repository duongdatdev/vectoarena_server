export type NftTokenStandard = "ERC721" | "ERC1155";

export type CheckNftOwnershipInput = {
  walletAddress: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  standard: NftTokenStandard;
};

export type NftOwnershipResult = {
  owned: boolean;
  balance: number;
};

export interface NftOwnershipService {
  checkNftOwnership(input: CheckNftOwnershipInput): Promise<NftOwnershipResult>;
}

type MockNftOwnershipRecord = {
  walletAddress: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  standard: NftTokenStandard;
  balance: number;
};

const MOCK_CHAIN_ID = 31337;
const MOCK_GENESIS_SKINS_CONTRACT = "0x0000000000000000000000000000000000000abc";

export const MOCK_WALLET_A = "0x1111111111111111111111111111111111111111";
export const MOCK_WALLET_B = "0x2222222222222222222222222222222222222222";

export const MOCK_NFT_SKIN_MAPPINGS = [
  {
    skinId: "CyberBunny",
    chainId: MOCK_CHAIN_ID,
    contractAddress: MOCK_GENESIS_SKINS_CONTRACT,
    tokenId: "1",
    standard: "ERC721" as NftTokenStandard,
  },
  {
    skinId: "Iceking",
    chainId: MOCK_CHAIN_ID,
    contractAddress: MOCK_GENESIS_SKINS_CONTRACT,
    tokenId: "2",
    standard: "ERC721" as NftTokenStandard,
  },
  {
    skinId: "Anubis",
    chainId: MOCK_CHAIN_ID,
    contractAddress: MOCK_GENESIS_SKINS_CONTRACT,
    tokenId: "3",
    standard: "ERC721" as NftTokenStandard,
  },
  {
    skinId: "GearedApe",
    chainId: MOCK_CHAIN_ID,
    contractAddress: MOCK_GENESIS_SKINS_CONTRACT,
    tokenId: "4",
    standard: "ERC721" as NftTokenStandard,
  },
];

const MOCK_NFT_OWNERSHIP: MockNftOwnershipRecord[] = [
  {
    walletAddress: MOCK_WALLET_A,
    chainId: MOCK_CHAIN_ID,
    contractAddress: MOCK_GENESIS_SKINS_CONTRACT,
    tokenId: "1",
    standard: "ERC721",
    balance: 1,
  },
];

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export class MockNftOwnershipService implements NftOwnershipService {
  constructor(private readonly records: MockNftOwnershipRecord[] = MOCK_NFT_OWNERSHIP) {}

  async checkNftOwnership(input: CheckNftOwnershipInput): Promise<NftOwnershipResult> {
    const normalizedWalletAddress = normalizeAddress(input.walletAddress);
    const normalizedContractAddress = normalizeAddress(input.contractAddress);

    const record = this.records.find(
      (item) =>
        normalizeAddress(item.walletAddress) === normalizedWalletAddress &&
        item.chainId === input.chainId &&
        normalizeAddress(item.contractAddress) === normalizedContractAddress &&
        item.tokenId === input.tokenId &&
        item.standard === input.standard
    );

    const balance = record?.balance ?? 0;
    return {
      owned: balance > 0,
      balance,
    };
  }
}

export const nftOwnershipService: NftOwnershipService = new MockNftOwnershipService();
