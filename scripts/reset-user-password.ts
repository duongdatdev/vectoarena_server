import bcrypt from "bcrypt";
import prisma from "../src/database/prisma";

async function main() {
    const [, , usernameArg, passwordArg] = process.argv;
    if (!usernameArg || !passwordArg) {
        console.error("Usage: ts-node scripts/reset-user-password.ts <username> <newPassword>");
        process.exit(1);
    }

    const cost = Number(process.env.BCRYPT_COST || 12);
    const hashed = await bcrypt.hash(passwordArg, cost);

    const result = await (prisma as any).user.updateMany({
        where: { username: usernameArg },
        data: { password: hashed },
    });

    if (result.count === 0) {
        console.error(`No user with username "${usernameArg}" found.`);
        process.exit(2);
    }

    console.log(`Password reset for user "${usernameArg}" (${result.count} row).`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
