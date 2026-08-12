import { AppDataSource } from "../config/data-source.js";
import { logger } from "../config/logger.js";
import { UserRole, UserStatus } from "../common/constants/roles.js";
import { hashPassword } from "../common/utils/password.js";
import { User } from "../entities/User.js";

export async function seedSuperAdmin(): Promise<void> {
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL ?? "superadmin@example.com")
    .trim()
    .toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? "Superadmin@123";
  const fullName = process.env.SEED_SUPER_ADMIN_NAME ?? "Super Admin";

  const users = AppDataSource.getRepository(User);
  const existing = await users.findOne({ where: { email } });

  if (existing) {
    logger.info({ email }, "Super admin already seeded");
    return;
  }

  const user = users.create({
    fullName,
    preferredName: null,
    email,
    mobile: null,
    passwordHash: await hashPassword(password),
    role: UserRole.SUPER_ADMIN,
    status: UserStatus.ACTIVE,
    employmentType: null,
    securitySetupComplete: true,
    invitationTokenHash: null,
    invitationExpiresAt: null,
  });

  await users.save(user);
  logger.info({ email }, "Seeded SUPER_ADMIN");
}
