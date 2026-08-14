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
import { User } from "../../entities/index.js";
import { emailService } from "../email/email.service.js";
import type {
  InvitePersonInput,
  InvitePersonResult,
  ListPeopleFilters,
  PersonDto,
  UpdatePersonInput,
} from "./types/users.types.js";

function toPersonDto(user: User): PersonDto {
  return {
    id: user.id,
    fullName: user.fullName,
    preferredName: user.preferredName,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    employmentType: user.employmentType,
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

  async list(filters: ListPeopleFilters): Promise<PersonDto[]> {
    const where: { status?: UserStatus; role?: UserRole } = {};
    if (filters.status) where.status = filters.status;
    if (filters.role) where.role = filters.role;

    const people = await this.users.find({
      where,
      order: { createdAt: "DESC" },
    });

    return people.map(toPersonDto);
  }

  async getById(id: string): Promise<PersonDto> {
    const user = await this.findUserOrThrow(id);
    return toPersonDto(user);
  }

  async invite(input: InvitePersonInput): Promise<InvitePersonResult> {
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
      securitySetupComplete: false,
      invitationTokenHash: null, // Not used anymore, using Redis
      invitationExpiresAt: null,  // Not used anymore, using Redis
    });

    await this.users.save(user);

    logger.info(
      { userId: user.id, email: user.email },
      "User created with INVITED status",
    );

    // Generate one-time invitation token and store in Redis
    const invitationToken = generateInvitationToken();
    await storeInvitationToken(invitationToken, {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
    });

    const invitationLink = `${env.FRONTEND_URL}/accept-invitation?token=${invitationToken}`;
    
    try {
      await emailService.sendInvitationEmail({
        to: user.email,
        fullName: user.fullName,
        invitationLink,
      });
      
      logger.info(
        { userId: user.id, email: user.email },
        "Invitation email sent successfully",
      );
    } catch (error) {
      // Log but don't fail - the invitation is still created
      logger.warn(
        { userId: user.id, error },
        "Failed to send invitation email, but invitation was created",
      );
    }

    return { person: toPersonDto(user), invitationToken };
  }

  async update(id: string, input: UpdatePersonInput): Promise<PersonDto> {
    const user = await this.findUserOrThrow(id);

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
    if (input.role !== undefined) user.role = input.role;
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

    await this.users.save(user);
    return toPersonDto(user);
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
      email: user.email,
      fullName: user.fullName,
    });

    logger.info({ userId: user.id }, "New invitation token generated");

    // Resend invitation email
    const invitationLink = `${env.FRONTEND_URL}/accept-invitation?token=${invitationToken}`;
    
    try {
      await emailService.sendInvitationEmail({
        to: user.email,
        fullName: user.fullName,
        invitationLink,
      });
      
      logger.info(
        { userId: user.id, email: user.email },
        "Invitation email resent successfully",
      );
    } catch (error) {
      // Log but don't fail - the invitation token is still refreshed
      logger.warn(
        { userId: user.id, error },
        "Failed to resend invitation email, but invitation token was refreshed",
      );
    }

    return { person: toPersonDto(user), invitationToken };
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
    return toPersonDto(user);
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

  private async findUserOrThrow(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new AppError(404, "Person not found", "NOT_FOUND");
    }
    return user;
  }
}

export const usersService = new UsersService();
