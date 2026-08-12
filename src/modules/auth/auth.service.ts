import { randomUUID } from "node:crypto";
import { AppDataSource } from "../../config/data-source.js";
import { UserStatus } from "../../common/constants/roles.js";
import { AppError } from "../../common/errors/AppError.js";
import { verifyInvitationToken } from "../../common/utils/invitation.js";
import { hashValue, verifyHash } from "../../common/utils/hash.js";
import {
  getRefreshExpiresAt,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../common/utils/jwt.js";
import { hashPassword, verifyPassword } from "../../common/utils/password.js";
import { RefreshToken, User } from "../../entities/index.js";
import type {
  AcceptInvitationInput,
  AuthResult,
  AuthTokens,
  LoginInput,
  PublicUser,
} from "./types/auth.types.js";
import {
  clearLoginLockout,
  getLoginLockStatus,
  recordFailedLoginAttempt,
} from "./utils/login-lockout.js";

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    fullName: user.fullName,
    preferredName: user.preferredName,
    email: user.email,
    mobile: user.mobile,
    role: user.role,
    status: user.status,
    securitySetupComplete: user.securitySetupComplete,
    lastSignedInAt: user.lastSignedInAt,
  };
}

export class AuthService {
  private readonly users = AppDataSource.getRepository(User);
  private readonly refreshTokens = AppDataSource.getRepository(RefreshToken);

  async acceptInvitation(input: AcceptInvitationInput): Promise<AuthResult> {
    const email = input.email.toLowerCase();
    const user = await this.users.findOne({ where: { email } });

    if (
      !user ||
      user.status !== UserStatus.INVITED ||
      !user.invitationTokenHash
    ) {
      throw new AppError(400, "Invitation is invalid", "INVALID_INVITATION");
    }

    if (!user.invitationExpiresAt || user.invitationExpiresAt < new Date()) {
      throw new AppError(400, "Invitation has expired", "INVITATION_EXPIRED");
    }

    const tokenValid = await verifyInvitationToken(
      input.token,
      user.invitationTokenHash,
    );

    if (!tokenValid) {
      throw new AppError(400, "Invitation is invalid", "INVALID_INVITATION");
    }

    if (input.preferredName !== undefined) {
      user.preferredName = input.preferredName?.trim() || null;
    }

    user.passwordHash = await hashPassword(input.password);
    user.status = UserStatus.ACTIVE;
    user.securitySetupComplete = true;
    user.invitationTokenHash = null;
    user.invitationExpiresAt = null;
    user.lastSignedInAt = new Date();

    await this.users.save(user);

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), tokens };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const email = input.email.toLowerCase();

    const lock = await getLoginLockStatus(email);
    if (lock.locked) {
      throw new AppError(
        429,
        "Too many attempts. Sign-in is paused for 15 minutes",
        "LOCKED",
        { lockedUntil: lock.lockedUntil },
      );
    }

    const user = await this.users.findOne({ where: { email } });

    if (!user || !user.passwordHash) {
      await recordFailedLoginAttempt(email);
      throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    if (user.status === UserStatus.DEACTIVATED) {
      throw new AppError(403, "This account has been deactivated", "DEACTIVATED");
    }

    if (user.status === UserStatus.INVITED) {
      throw new AppError(
        403,
        "Invitation has not been accepted yet",
        "INVITATION_PENDING",
      );
    }

    const valid = await verifyPassword(input.password, user.passwordHash);

    if (!valid) {
      const afterFail = await recordFailedLoginAttempt(email);

      if (afterFail.locked) {
        throw new AppError(
          429,
          "Too many attempts. Sign-in is paused for 15 minutes",
          "LOCKED",
          { lockedUntil: afterFail.lockedUntil },
        );
      }

      throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
    }

    await clearLoginLockout(email);
    user.lastSignedInAt = new Date();
    await this.users.save(user);

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), tokens };
  }

  async refresh(rawRefreshToken: string): Promise<AuthResult> {
    let payload;

    try {
      payload = verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new AppError(401, "Invalid or expired refresh token", "INVALID_TOKEN");
    }

    const stored = await this.refreshTokens.findOne({
      where: { id: payload.tokenId },
      relations: { user: true },
    });

    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt < new Date() ||
      !(await verifyHash(rawRefreshToken, stored.tokenHash))
    ) {
      throw new AppError(401, "Invalid or expired refresh token", "INVALID_TOKEN");
    }

    if (stored.user.status !== UserStatus.ACTIVE) {
      throw new AppError(403, "Account is not active", "INACTIVE");
    }

    stored.revokedAt = new Date();
    await this.refreshTokens.save(stored);

    const tokens = await this.issueTokens(stored.user);
    return { user: toPublicUser(stored.user), tokens };
  }

  async logout(rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    try {
      const payload = verifyRefreshToken(rawRefreshToken);
      const stored = await this.refreshTokens.findOne({
        where: { id: payload.tokenId },
      });

      if (stored && !stored.revokedAt) {
        stored.revokedAt = new Date();
        await this.refreshTokens.save(stored);
      }
    } catch {
      // Ignore invalid refresh tokens on logout
    }
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findOne({ where: { id: userId } });

    if (!user) {
      throw new AppError(404, "User not found", "NOT_FOUND");
    }

    return toPublicUser(user);
  }

  private async issueTokens(user: User): Promise<AuthTokens> {
    const tokenId = randomUUID();
    const refreshToken = signRefreshToken({ sub: user.id, tokenId });
    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    const record = this.refreshTokens.create({
      id: tokenId,
      tokenHash: await hashValue(refreshToken),
      userId: user.id,
      expiresAt: getRefreshExpiresAt(),
      revokedAt: null,
    });

    await this.refreshTokens.save(record);

    return { accessToken, refreshToken };
  }
}

export const authService = new AuthService();
