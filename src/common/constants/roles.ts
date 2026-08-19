export enum UserRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  OFFICE_STAFF = "OFFICE_STAFF",
  STAFF = "STAFF",
  STUDENT = "STUDENT",
  GUARDIAN = "GUARDIAN",
}

export const USER_ROLES = Object.values(UserRole);

/** Roles a Super Admin can invite directly (students enrol via guardian invite). */
export const INVITABLE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.OFFICE_STAFF,
  UserRole.STAFF,
  UserRole.GUARDIAN,
] as const;

export enum UserStatus {
  INVITED = "INVITED",
  ACTIVE = "ACTIVE",
  DEACTIVATED = "DEACTIVATED",
}

export enum EmploymentType {
  FULL_TIME = "FULL_TIME",
  PART_TIME = "PART_TIME",
  CONTRACT = "CONTRACT",
  CASUAL = "CASUAL",
}

export const EMPLOYMENT_TYPES = Object.values(EmploymentType);

export enum TwoFactorMethod {
  SMS = "SMS",
  AUTHENTICATOR = "AUTHENTICATOR",
  EMAIL = "EMAIL",
}

export const TWO_FACTOR_METHODS = Object.values(TwoFactorMethod);

export const INVITATION_TTL_HOURS = 48;
