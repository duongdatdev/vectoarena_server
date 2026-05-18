import prisma from "../src/database/prisma";
import { MOCK_NFT_SKIN_MAPPINGS } from "../src/managers/NftOwnershipService";

async function main() {
  console.log("[Seed] Gameplay balance is loaded from config/gameplay/default.json");

  for (const mapping of MOCK_NFT_SKIN_MAPPINGS) {
    await (prisma as any).skinNftMapping.upsert({
      where: {
        skinId_chainId_contractAddress_tokenId: {
          skinId: mapping.skinId,
          chainId: mapping.chainId,
          contractAddress: mapping.contractAddress,
          tokenId: mapping.tokenId,
        },
      },
      update: {
        standard: mapping.standard,
        active: true,
      },
      create: {
        ...mapping,
        active: true,
      },
    });
  }

  console.log(`[Seed] Upserted ${MOCK_NFT_SKIN_MAPPINGS.length} mock NFT skin mappings.`);
}

async function runSeed() {
  try {
    await main();
  } catch (error) {
    console.error("[Seed] Failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

void runSeed();
