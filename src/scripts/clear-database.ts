/**
 * Wipes application data from Postgres and local uploads, keeping only the
 * super admin account defined by SEED_SUPER_ADMIN_EMAIL.
 *
 * Run manually from the backend folder (not wired to Docker):
 *   npm run build
 *   npm run clear-data -- --confirm
 */
import "reflect-metadata";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { AppDataSource } from "../config/data-source.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { UserRole } from "../common/constants/roles.js";
import { User } from "../entities/index.js";
import { seedEnquiryCatalogue } from "../seeder/seed-enquiry-catalogue.js";

type TableRow = {
  schemaname: string;
  tablename: string;
};

function wantsConfirm(): boolean {
  return (
    process.argv.includes("--confirm") ||
    process.env.CLEAR_DATABASE_CONFIRM === "yes"
  );
}

function clearLocalUploads(): void {
  const uploadDir = join(process.cwd(), env.UPLOAD_LOCAL_DIR);
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
    return;
  }

  rmSync(uploadDir, { recursive: true, force: true });
  mkdirSync(uploadDir, { recursive: true });
  logger.info({ uploadDir }, "Cleared local uploads directory");
}

async function listApplicationTables(): Promise<TableRow[]> {
  return AppDataSource.query(`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname IN ('public', 'audit')
    ORDER BY schemaname, tablename
  `);
}

async function clearDatabase(): Promise<void> {
  const email = env.SEED_SUPER_ADMIN_EMAIL.trim().toLowerCase();
  const userRepo = AppDataSource.getRepository(User);
  const superAdmin = await userRepo.findOne({
    where: { email, role: UserRole.SUPER_ADMIN },
  });

  if (!superAdmin) {
    throw new Error(
      `Super admin not found for ${email}. Start the API once to seed it, then rerun this script.`,
    );
  }

  const tables = await listApplicationTables();
  if (tables.length === 0) {
    throw new Error("No application tables found to truncate.");
  }

  const qualifiedTables = tables
    .map((row) => `"${row.schemaname}"."${row.tablename}"`)
    .join(", ");

  logger.warn(
    { email, tableCount: tables.length },
    "Truncating all application tables",
  );

  await AppDataSource.transaction(async (manager) => {
    await manager.query(
      `TRUNCATE TABLE ${qualifiedTables} RESTART IDENTITY CASCADE`,
    );

    await manager.getRepository(User).insert({
      id: superAdmin.id,
      fullName: superAdmin.fullName,
      preferredName: superAdmin.preferredName,
      email: superAdmin.email,
      username: superAdmin.username,
      mobile: superAdmin.mobile,
      passwordHash: superAdmin.passwordHash,
      role: superAdmin.role,
      status: superAdmin.status,
      employmentType: superAdmin.employmentType,
      modulePermissions: superAdmin.modulePermissions,
      securitySetupComplete: superAdmin.securitySetupComplete,
      createdViaSandbox: superAdmin.createdViaSandbox,
      twoFactorMethod: superAdmin.twoFactorMethod,
      authenticatorSecret: superAdmin.authenticatorSecret,
      invitationTokenHash: superAdmin.invitationTokenHash,
      invitationExpiresAt: superAdmin.invitationExpiresAt,
      lastSignedInAt: superAdmin.lastSignedInAt,
      createdAt: superAdmin.createdAt,
      updatedAt: superAdmin.updatedAt,
    });
  });

  await seedEnquiryCatalogue();

  logger.info(
    { email },
    "Database cleared. Super admin and enquiry catalogue reference data restored.",
  );
}

async function main(): Promise<void> {
  if (!wantsConfirm()) {
    console.error(
      "Refusing to run without confirmation.\n" +
        "Use: npm run clear-data -- --confirm\n" +
        "Or set CLEAR_DATABASE_CONFIRM=yes",
    );
    process.exit(1);
  }

  await AppDataSource.initialize();
  try {
    clearLocalUploads();
    await clearDatabase();

    if (
      env.LINODE_OBJECT_STORAGE_ENDPOINT &&
      env.LINODE_OBJECT_STORAGE_BUCKET
    ) {
      logger.warn(
        "Object storage is configured. Uploaded files in the remote bucket were not deleted by this script.",
      );
    }
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main().catch((error) => {
  logger.error({ err: error }, "Failed to clear database");
  process.exit(1);
});
