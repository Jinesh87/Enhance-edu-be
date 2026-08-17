import { AppDataSource } from "../config/data-source.js";
import { logger } from "../config/logger.js";
import { UserRole, UserStatus } from "../common/constants/roles.js";
import { hashPassword } from "../common/utils/password.js";
import { env } from "../config/env.js";
import { User } from "../entities/index.js";

export async function seedSuperAdmin(): Promise<void> {
  const email = env.SEED_SUPER_ADMIN_EMAIL
    .trim()
    .toLowerCase();
  const password = env.SEED_SUPER_ADMIN_PASSWORD;
  const fullName = env.SEED_SUPER_ADMIN_NAME;

  const usersRepo = AppDataSource.getRepository(User);

  const existing = await usersRepo.findOne({ where: { email } });

  if (existing) {
    logger.info(
      { email },
      "Super admin already seeded. Checking rest of the seed data...",
    );
  } else {
    const user = usersRepo.create({
      fullName,
      preferredName: null,
      email,
      passwordHash: await hashPassword(password),
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      employmentType: null,
      securitySetupComplete: true,
      invitationTokenHash: null,
      invitationExpiresAt: null,
    });
    await usersRepo.save(user);
    logger.info({ email }, "Seeded SUPER_ADMIN");
  }

  // 1. Seed Teacher (Kassem Haddad)
  const teacherEmail = "staff@example.com";
  let teacher = await usersRepo.findOne({ where: { email: teacherEmail } });
  if (!teacher) {
    teacher = usersRepo.create({
      fullName: "Kassem Haddad",
      preferredName: "Kassem",
      email: teacherEmail,
      mobile: "0499 999 999",
      passwordHash: await hashPassword("Superadmin@123"),
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
      employmentType: null,
      securitySetupComplete: true,
    });
    await usersRepo.save(teacher);
    logger.info("Seeded Teacher (Kassem Haddad)");
  }

  // 2. Seed Student (Leo Karim)
  const studentEmail = "student@example.com";
  let student = await usersRepo.findOne({ where: { email: studentEmail } });
  if (!student) {
    student = usersRepo.create({
      fullName: "Leo Karim",
      preferredName: "Leo",
      email: studentEmail,
      mobile: "0400 123 456",
      passwordHash: await hashPassword("Superadmin@123"),
      role: UserRole.STUDENT,
      status: UserStatus.ACTIVE,
      employmentType: null,
      securitySetupComplete: true,
    });
    await usersRepo.save(student);
    logger.info("Seeded Student (Leo Karim)");
  }

  logger.info("Database seed completion verified.");
}
