import { AppDataSource } from "../../config/data-source.js";
import { logger } from "../../config/logger.js";
import { UserRole, UserStatus } from "../../common/constants/roles.js";
import { AppError } from "../../common/errors/AppError.js";
import { env } from "../../config/env.js";
import {
  generateInvitationToken,
  storeInvitationToken,
  deleteUserInvitationTokens,
} from "../../common/utils/invitation-redis.js";
import { deleteUserPasswordResetTokens } from "../../common/utils/password-reset-redis.js";
import { In } from "typeorm";
import { User, TeacherSubject, Enrollment, PendingEnrollment, Student } from "../../entities/index.js";
import { PendingEnrollmentStatus } from "../../common/constants/enrollment.js";
import { emailService } from "../email/email.service.js";
import { adminEnrollmentsService } from "../admin/enrollments/admin-enrollments.service.js";
import { sanitizeModulePermissions } from "../../common/constants/modules.js";
import { writeAuditLog, changedFields } from "../../common/utils/audit-log.js";
import type {
  InvitePersonInput,
  InvitePersonResult,
  ListPeopleFilters,
  PersonDto,
  UpdatePersonInput,
} from "./types/users.types.js";

function assertActorCanManagePerson(
  actor: User,
  targetRole: UserRole,
  modulePermissions?: string[] | null,
) {
  if (actor.role === UserRole.SUPER_ADMIN) return;
  if (targetRole === UserRole.SUPER_ADMIN) {
    throw new AppError(
      403,
      "Only an application owner can manage owner accounts",
      "FORBIDDEN",
    );
  }
  if (targetRole === UserRole.OFFICE_STAFF && Array.isArray(modulePermissions)) {
    const granted = sanitizeModulePermissions(modulePermissions);
    const mine = actor.modulePermissions ?? [];
    if (granted.some((id) => !mine.includes(id))) {
      throw new AppError(
        403,
        "You can only assign modules you have access to",
        "MODULE_FORBIDDEN",
      );
    }
  }
}

function toPersonDto(user: User): PersonDto {
  return {
    id: user.id,
    fullName: user.fullName,
    preferredName: user.preferredName,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    employmentType: user.employmentType,
    modulePermissions: user.modulePermissions ?? [],
    securitySetupComplete: user.securitySetupComplete,
    status: user.status,
    lastSignedInAt: user.lastSignedInAt,
    invitationExpiresAt: user.invitationExpiresAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class UsersService {
  private readonly users = AppDataSource.getRepository(User);
  private readonly teacherSubjects = AppDataSource.getRepository(TeacherSubject);
  private readonly enrollments = AppDataSource.getRepository(Enrollment);
  private readonly pendingEnrollments = AppDataSource.getRepository(PendingEnrollment);
  private readonly students = AppDataSource.getRepository(Student);

  async list(
    filters: ListPeopleFilters,
  ): Promise<{ people: PersonDto[]; total: number; activeCount: number; invitedCount: number }> {
    const where: { status?: UserStatus; role?: UserRole } = {};
    if (filters.status) where.status = filters.status;
    if (filters.role) where.role = filters.role;

    const findOptions: any = {
      where,
      order: { createdAt: "DESC" },
    };

    if (filters.page && filters.limit) {
      findOptions.skip = (filters.page - 1) * filters.limit;
      findOptions.take = filters.limit;
    }

    const [users, total] = await this.users.findAndCount(findOptions);
    const activeCount = await this.users.count({ where: { ...where, status: UserStatus.ACTIVE } });
    const invitedCount = await this.users.count({ where: { ...where, status: UserStatus.INVITED } });

    // Efficiently load teacher subjects to avoid N+1 query
    const staffIds = users
      .filter((p) => p.role === UserRole.STAFF)
      .map((p) => p.id);
    const subjectsMap: Record<string, string[]> = {};
    if (staffIds.length > 0) {
      const tsRecords = await this.teacherSubjects.find({
        where: { teacherId: In(staffIds) },
      });
      for (const ts of tsRecords) {
        if (!subjectsMap[ts.teacherId]) {
          subjectsMap[ts.teacherId] = [];
        }
        subjectsMap[ts.teacherId].push(ts.subjectId);
      }
    }

    const trialAccountIds = await this.findTrialAccountUserIds(
      users.map((user) => user.id),
    );

    const people = users.map((user) => {
      const dto = toPersonDto(user);
      if (user.role === UserRole.STAFF) {
        dto.subjectIds = subjectsMap[user.id] || [];
      }
      dto.isTrialAccount = trialAccountIds.has(user.id);
      return dto;
    });

    return { people, total, activeCount, invitedCount };
  }

  private async findTrialAccountUserIds(userIds: string[]): Promise<Set<string>> {
    const trialIds = new Set<string>();
    if (userIds.length === 0) return trialIds;

    const [studentRows, guardianEnrollmentRows, guardianPendingRows] =
      await Promise.all([
        this.enrollments
          .createQueryBuilder("enrollment")
          .innerJoin("enrollment.term", "term")
          .innerJoin(Student, "student", "student.id = enrollment.studentId")
          .where("term.isTrial = true")
          .andWhere("student.userId IN (:...userIds)", { userIds })
          .select("student.userId", "userId")
          .getRawMany<{ userId: string }>(),
        this.enrollments
          .createQueryBuilder("enrollment")
          .innerJoin("enrollment.term", "term")
          .where("term.isTrial = true")
          .andWhere("enrollment.guardianId IN (:...userIds)", { userIds })
          .select("enrollment.guardianId", "userId")
          .getRawMany<{ userId: string }>(),
        this.pendingEnrollments
          .createQueryBuilder("pending")
          .innerJoin("pending.term", "term")
          .where("term.isTrial = true")
          .andWhere("pending.status = :status", {
            status: PendingEnrollmentStatus.PENDING,
          })
          .andWhere("pending.guardianId IN (:...userIds)", { userIds })
          .select("pending.guardianId", "userId")
          .getRawMany<{ userId: string }>(),
      ]);

    for (const row of [
      ...studentRows,
      ...guardianEnrollmentRows,
      ...guardianPendingRows,
    ]) {
      if (row.userId) trialIds.add(row.userId);
    }

    return trialIds;
  }

  async getById(id: string): Promise<PersonDto> {
    const user = await this.findUserOrThrow(id);
    const dto = toPersonDto(user);
    if (user.role === UserRole.STAFF) {
      const tsRecords = await this.teacherSubjects.find({
        where: { teacherId: user.id },
      });
      dto.subjectIds = tsRecords.map((ts) => ts.subjectId);
    }
    const trialIds = await this.findTrialAccountUserIds([user.id]);
    dto.isTrialAccount = trialIds.has(user.id);
    return this.withRelatedPeople(dto);
  }

  async invite(
    input: InvitePersonInput,
    actorId: string,
  ): Promise<InvitePersonResult> {
    if (input.role === UserRole.STUDENT) {
      throw new AppError(
        400,
        "Students are enrolled by inviting a guardian with student details",
        "STUDENT_INVITE_DISABLED",
      );
    }

    const actor = await this.users.findOne({ where: { id: actorId } });
    if (!actor) {
      throw new AppError(401, "Authentication required", "UNAUTHORIZED");
    }
    assertActorCanManagePerson(actor, input.role, input.modulePermissions);

    const email = input.email.toLowerCase();
    const existing = await this.users.findOne({ where: { email } });

    if (existing) {
      throw new AppError(
        409,
        `Email is already used by ${existing.fullName}`,
        "EMAIL_IN_USE",
        {
          heldBy: {
            id: existing.id,
            fullName: existing.fullName,
            email: existing.email,
          },
        },
      );
    }

    // Create user record
    const user = this.users.create({
      fullName: input.fullName.trim(),
      preferredName: input.preferredName?.trim() || null,
      email,
      mobile: input.mobile?.trim() || null,
      passwordHash: null,
      role: input.role,
      status: UserStatus.INVITED,
      employmentType: input.employmentType ?? null,
      modulePermissions:
        input.role === UserRole.OFFICE_STAFF
          ? sanitizeModulePermissions(input.modulePermissions)
          : null,
      securitySetupComplete: false,
      invitationTokenHash: null, // Not used anymore, using Redis
      invitationExpiresAt: null,  // Not used anymore, using Redis
    });

    await this.users.save(user);

    logger.info(
      { userId: user.id, email: user.email },
      "User created with INVITED status",
    );

    await writeAuditLog({
      actorUserId: actorId,
      action: "CREATED",
      recordType: "person",
      recordId: user.id,
      recordLabel: user.fullName,
      after: {
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
        modulePermissions: user.modulePermissions,
      },
    });

    const dto = toPersonDto(user);

    if (input.role === UserRole.STAFF && input.subjectIds && input.subjectIds.length > 0) {
      const tsRecords = input.subjectIds.map((subjectId) =>
        this.teacherSubjects.create({
          teacherId: user.id,
          subjectId,
        })
      );
      await this.teacherSubjects.save(tsRecords);
      dto.subjectIds = input.subjectIds;
    } else if (input.role === UserRole.STAFF) {
      dto.subjectIds = [];
    }

    const result: InvitePersonResult = {
      person: dto,
      invitationToken: "",
    };

    if (
      input.role === UserRole.GUARDIAN &&
      input.student &&
      input.enrollment
    ) {
      await adminEnrollmentsService.queuePendingEnrollmentForGuardian(
        user.id,
        input.student,
        input.enrollment,
        actorId,
      );
      result.pendingEnrollment = {
        studentFullName: input.student.fullName.trim(),
        status: "AWAITING_GUARDIAN",
      };
    }

    // Generate one-time invitation token and store in Redis
    const invitationToken = generateInvitationToken();
    await storeInvitationToken(invitationToken, {
      userId: user.id,
      email: user.email!,
      fullName: user.fullName,
    });
    result.invitationToken = invitationToken;

    const invitationLink = `${env.FRONTEND_URL}/accept-invitation?token=${invitationToken}`;
    const enrollments =
      input.role === UserRole.GUARDIAN
        ? await adminEnrollmentsService.listPendingEnrollmentEmailDetails(user.id)
        : [];
    
    try {
      await emailService.sendInvitationEmail({
        to: user.email!,
        fullName: user.fullName,
        invitationLink,
        enrollments,
      });
      
      logger.info(
        { userId: user.id, email: user.email },
        "Invitation email sent successfully",
      );
    } catch (error) {
      logger.error(
        { userId: user.id, error },
        "Failed to send invitation email",
      );
      throw error instanceof AppError
        ? error
        : new AppError(
            500,
            "Failed to send invitation email",
            "EMAIL_SEND_FAILED",
          );
    }

    return result;
  }

  async update(
    id: string,
    input: UpdatePersonInput,
    actorId?: string,
  ): Promise<PersonDto> {
    const user = await this.findUserOrThrow(id);
    const actor = actorId
      ? await this.users.findOne({ where: { id: actorId } })
      : null;
    if (actorId && !actor) {
      throw new AppError(401, "Authentication required", "UNAUTHORIZED");
    }
    if (actor) {
      if (user.role === UserRole.SUPER_ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
        throw new AppError(
          403,
          "Only an application owner can manage owner accounts",
          "FORBIDDEN",
        );
      }
      assertActorCanManagePerson(
        actor,
        input.role ?? user.role,
        input.modulePermissions,
      );
    }

    const before = {
      fullName: user.fullName,
      preferredName: user.preferredName,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      employmentType: user.employmentType,
      status: user.status,
      modulePermissions: user.modulePermissions,
    };

    if (input.email && input.email.toLowerCase() !== user.email) {
      if (user.status !== UserStatus.INVITED) {
        throw new AppError(
          400,
          "Email can only be corrected while the invitation is pending",
          "EMAIL_LOCKED",
        );
      }

      const email = input.email.toLowerCase();
      const clash = await this.users.findOne({ where: { email } });
      if (clash && clash.id !== user.id) {
        throw new AppError(
          409,
          `Email is already used by ${clash.fullName}`,
          "EMAIL_IN_USE",
          {
            heldBy: {
              id: clash.id,
              fullName: clash.fullName,
              email: clash.email,
            },
          },
        );
      }
      user.email = email;
    }

    if (input.fullName !== undefined) user.fullName = input.fullName.trim();
    if (input.preferredName !== undefined) {
      user.preferredName = input.preferredName?.trim() || null;
    }
    if (input.mobile !== undefined) {
      user.mobile = input.mobile?.trim() || null;
    }
    if (input.role !== undefined) {
      if (input.role === UserRole.STUDENT) {
        throw new AppError(
          400,
          "Students are enrolled by inviting a guardian with student details",
          "STUDENT_INVITE_DISABLED",
        );
      }
      user.role = input.role;
    }
    if (input.employmentType !== undefined) {
      user.employmentType = input.employmentType;
    }
    if (input.status !== undefined) {
      if (
        user.status === UserStatus.INVITED &&
        input.status === UserStatus.ACTIVE
      ) {
        throw new AppError(
          400,
          "Invited people become active by accepting their invitation",
          "INVALID_STATUS_TRANSITION",
        );
      }
      user.status = input.status;
    }
    if (user.role === UserRole.OFFICE_STAFF) {
      if (input.modulePermissions !== undefined) {
        const permissions = sanitizeModulePermissions(input.modulePermissions);
        if (permissions.length === 0) {
          throw new AppError(
            400,
            "Assign at least one module to this staff account",
            "MODULES_REQUIRED",
          );
        }
        user.modulePermissions = permissions;
      } else if (
        input.role === UserRole.OFFICE_STAFF &&
        !sanitizeModulePermissions(user.modulePermissions).length
      ) {
        throw new AppError(
          400,
          "Assign at least one module to this staff account",
          "MODULES_REQUIRED",
        );
      }
    } else if (input.role !== undefined) {
      user.modulePermissions = null;
    }

    await this.users.save(user);

    if (user.role === UserRole.STAFF && input.subjectIds !== undefined) {
      await this.teacherSubjects.delete({ teacherId: user.id });
      if (input.subjectIds.length > 0) {
        const tsRecords = input.subjectIds.map((subjectId) =>
          this.teacherSubjects.create({
            teacherId: user.id,
            subjectId,
          })
        );
        await this.teacherSubjects.save(tsRecords);
      }
    } else if (input.role !== undefined && input.role !== UserRole.STAFF) {
      // If role was updated from STAFF to something else, remove teacher subjects
      await this.teacherSubjects.delete({ teacherId: user.id });
    }

    const dto = toPersonDto(user);
    if (user.role === UserRole.STAFF) {
      const tsRecords = await this.teacherSubjects.find({
        where: { teacherId: user.id },
      });
      dto.subjectIds = tsRecords.map((ts) => ts.subjectId);
    }

    const after = {
      fullName: user.fullName,
      preferredName: user.preferredName,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      employmentType: user.employmentType,
      status: user.status,
      modulePermissions: user.modulePermissions,
    };
    const diff = changedFields(before, after);
    if (diff.before || diff.after) {
      await writeAuditLog({
        actorUserId: actorId,
        action: "EDITED",
        recordType: "person",
        recordId: user.id,
        recordLabel: user.fullName,
        before: diff.before,
        after: diff.after,
      });
    }

    return this.withRelatedPeople(dto);
  }

  async resendInvitation(id: string): Promise<InvitePersonResult> {
    const user = await this.findUserOrThrow(id);

    if (user.status !== UserStatus.INVITED) {
      throw new AppError(
        400,
        "Only pending invitations can be resent",
        "NOT_INVITED",
      );
    }

    // Delete any previous invitation tokens for this user
    await deleteUserInvitationTokens(user.id);

    // Generate new one-time invitation token and store in Redis
    const invitationToken = generateInvitationToken();
    await storeInvitationToken(invitationToken, {
      userId: user.id,
      email: user.email!,
      fullName: user.fullName,
    });

    logger.info({ userId: user.id }, "New invitation token generated");

    // Resend invitation email
    const invitationLink = `${env.FRONTEND_URL}/accept-invitation?token=${invitationToken}`;
    const enrollments =
      user.role === UserRole.GUARDIAN
        ? await adminEnrollmentsService.listPendingEnrollmentEmailDetails(user.id)
        : [];
    
    try {
      await emailService.sendInvitationEmail({
        to: user.email!,
        fullName: user.fullName,
        invitationLink,
        enrollments,
      });
      
      logger.info(
        { userId: user.id, email: user.email },
        "Invitation email resent successfully",
      );
    } catch (error) {
      logger.error(
        { userId: user.id, error },
        "Failed to resend invitation email",
      );
      throw error instanceof AppError
        ? error
        : new AppError(
            500,
            "Failed to resend invitation email",
            "EMAIL_SEND_FAILED",
          );
    }

    return {
      person: await this.withRelatedPeople(toPersonDto(user)),
      invitationToken,
    };
  }

  async deactivate(id: string, actorId: string): Promise<PersonDto> {
    if (id === actorId) {
      throw new AppError(
        400,
        "You cannot deactivate your own account",
        "SELF_DEACTIVATE",
      );
    }

    const user = await this.findUserOrThrow(id);
    await this.assertNotLastOwner(user);
    user.status = UserStatus.DEACTIVATED;
    await this.users.save(user);
    await writeAuditLog({
      actorUserId: actorId,
      action: "EDITED",
      recordType: "person",
      recordId: user.id,
      recordLabel: user.fullName,
      before: { status: "ACTIVE" },
      after: { status: UserStatus.DEACTIVATED },
    });
    return this.withRelatedPeople(toPersonDto(user));
  }

  async remove(id: string, actorId: string): Promise<void> {
    if (id === actorId) {
      throw new AppError(
        400,
        "You cannot delete your own account",
        "SELF_DELETE",
      );
    }

    const user = await this.findUserOrThrow(id);
    await this.assertNotLastOwner(user);

    await deleteUserInvitationTokens(user.id);
    await deleteUserPasswordResetTokens(user.id);
    await this.users.remove(user);

    await writeAuditLog({
      actorUserId: actorId,
      action: "DELETED",
      recordType: "person",
      recordId: id,
      recordLabel: user.fullName,
      before: {
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });

    logger.info({ userId: id, email: user.email }, "User deleted");
  }

  private async assertNotLastOwner(user: User): Promise<void> {
    if (user.role !== UserRole.SUPER_ADMIN) return;

    const ownerCount = await this.users.count({
      where: { role: UserRole.SUPER_ADMIN },
    });

    if (ownerCount <= 1) {
      throw new AppError(
        400,
        "At least one Application Owner must remain",
        "LAST_OWNER",
      );
    }
  }

  private async withRelatedPeople(dto: PersonDto): Promise<PersonDto> {
    if (dto.role === UserRole.GUARDIAN) {
      dto.students =
        await adminEnrollmentsService.listConnectedStudentsForGuardian(dto.id);
    }
    if (dto.role === UserRole.STUDENT) {
      dto.guardians =
        await adminEnrollmentsService.listGuardiansForStudentUser(dto.id);
    }
    return dto;
  }

  private async findUserOrThrow(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new AppError(404, "Person not found", "NOT_FOUND");
    }
    return user;
  }
}

export const usersService = new UsersService();
