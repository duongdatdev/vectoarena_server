import bcrypt from "bcrypt";
import prisma from "../src/database/prisma";
import { MOCK_NFT_SKIN_MAPPINGS } from "../src/managers/NftOwnershipService";

async function main() {
  console.log("[Seed] Gameplay balance is loaded from config/gameplay/default.json");

  const shouldSeedMockNftMappings = process.env.NFT_OWNERSHIP_SERVICE === "mock" || process.env.NODE_ENV === "test";
  if (shouldSeedMockNftMappings) {
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
  } else {
    console.log("[Seed] Skipped mock NFT skin mappings. Set NFT_OWNERSHIP_SERVICE=mock to seed local mappings.");
  }

  const adminUsername = process.env.ADMIN_USERNAME?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminUsername && adminPassword) {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    await (prisma as any).user.upsert({
      where: { username: adminUsername },
      update: {
        password: hashedPassword,
        role: "ADMIN",
      },
      create: {
        username: adminUsername,
        password: hashedPassword,
        role: "ADMIN",
        loadout: {
          create: {
            equippedPlayerSkin: "Female01",
          },
        },
        skinInventory: {
          create: {
            skinCode: "Female01",
            skinType: "PLAYER",
            source: "SHOP",
          },
        },
      },
    });

    console.log(`[Seed] Upserted admin user "${adminUsername}".`);
  } else {
    console.log("[Seed] Skipped admin bootstrap. Set ADMIN_USERNAME and ADMIN_PASSWORD to create one.");
  }
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
