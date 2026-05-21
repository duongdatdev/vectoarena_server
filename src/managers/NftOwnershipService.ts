import { ethers } from "ethers";

export type NftTokenStandard = "ERC721" | "ERC1155";
export type Erc721OwnershipCheckMethod = "ownerOf" | "balanceOf";

export type CheckNftOwnershipInput = {
  walletAddress: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  standard: NftTokenStandard;
  erc721CheckMethod?: Erc721OwnershipCheckMethod;
};

export type NftOwnershipResult = {
  owned: boolean;
  balance: number;
};

export interface NftOwnershipService {
  checkNftOwnership(input: CheckNftOwnershipInput): Promise<NftOwnershipResult>;
}

export const ERC1155_MINIMAL_ABI = ["function balanceOf(address account, uint256 id) view returns (uint256)"];

export const ERC721_MINIMAL_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
];

export class NftOwnershipServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "NftOwnershipServiceError";
  }
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

function getRpcUrl(chainId: number): string | null {
  const chainSpecificRpcUrl = process.env[`NFT_RPC_URL_${chainId}`];
  if (chainSpecificRpcUrl) {
    return chainSpecificRpcUrl;
  }

  if (chainId === 11155111) {
    return process.env.SEPOLIA_RPC_URL || null;
  }

  if (chainId === 84532) {
    return process.env.RPC_URL_BASE_SEPOLIA || null;
  }

  return null;
}

function getErc721CheckMethod(input: CheckNftOwnershipInput): Erc721OwnershipCheckMethod {
  const envMethod = process.env.NFT_ERC721_CHECK_METHOD;
  if (input.erc721CheckMethod === "balanceOf" || input.erc721CheckMethod === "ownerOf") {
    return input.erc721CheckMethod;
  }
  if (envMethod === "balanceOf" || envMethod === "ownerOf") {
    return envMethod;
  }
  return "ownerOf";
}

function toSafeNumber(value: bigint): number {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  return value > maxSafe ? Number.MAX_SAFE_INTEGER : Number(value);
}

function formatRpcError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
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

export class EthersNftOwnershipService implements NftOwnershipService {
  private readonly providers = new Map<number, ethers.JsonRpcProvider>();

  async checkNftOwnership(input: CheckNftOwnershipInput): Promise<NftOwnershipResult> {
    if (!ethers.isAddress(input.walletAddress)) {
      throw new NftOwnershipServiceError("Invalid wallet address.", "INVALID_WALLET_ADDRESS", {
        walletAddress: input.walletAddress,
      });
    }

    if (!ethers.isAddress(input.contractAddress)) {
      throw new NftOwnershipServiceError("Invalid NFT contract address.", "INVALID_CONTRACT_ADDRESS", {
        contractAddress: input.contractAddress,
      });
    }

    const provider = this.getProvider(input.chainId);
    const walletAddress = ethers.getAddress(input.walletAddress);
    const contractAddress = ethers.getAddress(input.contractAddress);

    console.debug("[NftOwnershipService] Checking ownership", {
      chainId: input.chainId,
      contractAddress,
      tokenId: input.tokenId,
      standard: input.standard,
      walletAddress,
    });

    try {
      if (input.standard === "ERC1155") {
        const contract = new ethers.Contract(contractAddress, ERC1155_MINIMAL_ABI, provider);
        const balance = BigInt(await contract.balanceOf(walletAddress, input.tokenId));
        return {
          owned: balance > 0n,
          balance: toSafeNumber(balance),
        };
      }

      if (input.standard === "ERC721") {
        return await this.checkErc721Ownership(provider, contractAddress, walletAddress, input);
      }

      throw new NftOwnershipServiceError("Unsupported NFT token standard.", "UNSUPPORTED_STANDARD", {
        standard: input.standard,
      });
    } catch (error) {
      if (error instanceof NftOwnershipServiceError) {
        throw error;
      }

      throw new NftOwnershipServiceError("Unable to read NFT ownership from RPC.", "RPC_READ_FAILED", {
        chainId: input.chainId,
        contractAddress,
        tokenId: input.tokenId,
        standard: input.standard,
        rpcError: formatRpcError(error),
      });
    }
  }

  private getProvider(chainId: number): ethers.JsonRpcProvider {
    const existingProvider = this.providers.get(chainId);
    if (existingProvider) {
      return existingProvider;
    }

    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      throw new NftOwnershipServiceError("NFT RPC URL is not configured for this chain.", "NFT_RPC_NOT_CONFIGURED", {
        chainId,
        expectedEnv: `NFT_RPC_URL_${chainId}`,
        fallbackEnv: chainId === 11155111 ? "SEPOLIA_RPC_URL" : chainId === 84532 ? "RPC_URL_BASE_SEPOLIA" : undefined,
      });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
    this.providers.set(chainId, provider);
    return provider;
  }

  private async checkErc721Ownership(
    provider: ethers.JsonRpcProvider,
    contractAddress: string,
    walletAddress: string,
    input: CheckNftOwnershipInput
  ): Promise<NftOwnershipResult> {
    const contract = new ethers.Contract(contractAddress, ERC721_MINIMAL_ABI, provider);
    const checkMethod = getErc721CheckMethod(input);

    if (checkMethod === "balanceOf") {
      const balance = BigInt(await contract.balanceOf(walletAddress));
      return {
        owned: balance > 0n,
        balance: toSafeNumber(balance),
      };
    }

    const owner = await contract.ownerOf(input.tokenId);
    const owned = normalizeAddress(owner) === normalizeAddress(walletAddress);
    return {
      owned,
      balance: owned ? 1 : 0,
    };
  }
}

function createNftOwnershipService(): NftOwnershipService {
  if (process.env.NFT_OWNERSHIP_SERVICE === "mock" || process.env.NODE_ENV === "test") {
    console.log("[NftOwnershipService] Using mock NFT ownership service.");
    return new MockNftOwnershipService();
  }

  return new EthersNftOwnershipService();
}

export const nftOwnershipService: NftOwnershipService = createNftOwnershipService();
