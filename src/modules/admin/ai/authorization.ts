import type { AdminModuleId } from "../../../common/constants/modules.js";
import { UserRole } from "../../../common/constants/roles.js";
import { AppError } from "../../../common/errors/AppError.js";
import { AppDataSource } from "../../../config/data-source.js";
import { env } from "../../../config/env.js";
import { User } from "../../../entities/User.js";

export type AdminAiActor = {
  id: string;
  email: string;
  role: UserRole;
  modulePermissions: string[];
};

const CONSOLE_ROLES = new Set<UserRole>([
  UserRole.SUPER_ADMIN,
  UserRole.OFFICE_STAFF,
]);

export function assertAdminAiEnabled() {
  if (!env.ADMIN_AI_ENABLED) {
    throw new AppError(
      503,
      "Admin AI is disabled",
      "ADMIN_AI_DISABLED",
    );
  }
}

export async function resolveAdminAiActor(userId: string): Promise<AdminAiActor> {
  const user = await AppDataSource.getRepository(User).findOne({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      modulePermissions: true,
      status: true,
    },
  });

  if (!user) {
    throw new AppError(401, "Authentication required", "UNAUTHORIZED");
  }

  if (!CONSOLE_ROLES.has(user.role)) {
    throw new AppError(
      403,
      "You do not have permission to access this information.",
      "ADMIN_AI_FORBIDDEN",
    );
  }

  return {
    id: user.id,
    email: user.email ?? "",
    role: user.role,
    modulePermissions: user.modulePermissions ?? [],
  };
}

export function canUseAdminAiModule(
  actor: AdminAiActor,
  moduleId: AdminModuleId,
): boolean {
  if (actor.role === UserRole.SUPER_ADMIN) return true;
  if (actor.role !== UserRole.OFFICE_STAFF) return false;
  return actor.modulePermissions.includes(moduleId);
}

export function assertAdminAiModule(
  actor: AdminAiActor,
  moduleId: AdminModuleId,
) {
  if (!canUseAdminAiModule(actor, moduleId)) {
    throw new AppError(
      403,
      "You do not have permission to access this information.",
      "ADMIN_AI_MODULE_FORBIDDEN",
    );
  }
}
