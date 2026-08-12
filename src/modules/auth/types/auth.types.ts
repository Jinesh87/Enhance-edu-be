import { UserRole, UserStatus } from "../../../common/constants/roles.js";

export type PublicUser = {
  id: string;
  fullName: string;
  preferredName: string | null;
  email: string;
  mobile: string | null;
  role: UserRole;
  status: UserStatus;
  securitySetupComplete: boolean;
  lastSignedInAt: Date | null;
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type LoginLockStatus = {
  locked: boolean;
  lockedUntil: Date | null;
};

export type AcceptInvitationInput = {
  email: string;
  token: string;
  password: string;
  preferredName?: string | null;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type AuthResult = {
  user: PublicUser;
  tokens: AuthTokens;
};
