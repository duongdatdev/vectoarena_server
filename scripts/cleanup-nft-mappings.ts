import prisma from "../src/database/prisma";

type MappingRow = {
  id: string;
  skinId: string;
  chainId: number;
  contractAddress: string;
  tokenId: string;
  standard: string;
  active: boolean;
  _count: {
    userCaches: number;
    purchaseHistory: number;
  };
};

function getArgValue(name: string): string | null {
  const prefix = `${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function main() {
  const keepContract = getArgValue("--keep-contract")?.toLowerCase() ?? null;
  const shouldDelete = process.argv.includes("--delete");

  const mappings: MappingRow[] = await (prisma as any).skinNftMapping.findMany({
    orderBy: [{ skinId: "asc" }, { chainId: "asc" }, { tokenId: "asc" }],
    include: {
      _count: { select: { userCaches: true, purchaseHistory: true } },
    },
  });

  console.table(
    mappings.map((mapping) => ({
      skinId: mapping.skinId,
      chainId: mapping.chainId,
      contractAddress: mapping.contractAddress,
      tokenId: mapping.tokenId,
      standard: mapping.standard,
      active: mapping.active,
      caches: mapping._count.userCaches,
      purchases: mapping._count.purchaseHistory,
      action: keepContract && mapping.contractAddress.toLowerCase() !== keepContract ? "DELETE" : "KEEP",
    })),
  );

  if (!keepContract) {
    console.log("Preview only. Pass --keep-contract=<address> to mark rows for deletion.");
    return;
  }

  const deleteIds = mappings
    .filter((mapping) => mapping.contractAddress.toLowerCase() !== keepContract)
    .map((mapping) => mapping.id);

  if (!shouldDelete) {
    console.log(`Preview only. ${deleteIds.length} rows would be deleted. Pass --delete to apply.`);
    return;
  }

  const result = await (prisma as any).skinNftMapping.deleteMany({
    where: { id: { in: deleteIds } },
  });

  console.log(`Deleted ${result.count} NFT skin mappings.`);
}

void main()
  .catch((error) => {
    console.error("[cleanup-nft-mappings] Failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
