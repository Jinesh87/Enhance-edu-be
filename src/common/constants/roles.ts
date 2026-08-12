export enum UserRole {
  SUPER_ADMIN = "SUPER_ADMIN",
  STAFF = "STAFF",
  STUDENT = "STUDENT",
  GUARDIAN = "GUARDIAN",
}

export const USER_ROLES = Object.values(UserRole);

/** Roles a Super Admin can invite (not another bootstrap Super Admin via People). */
export const INVITABLE_ROLES = [
  UserRole.SUPER_ADMIN,
  UserRole.STAFF,
  UserRole.STUDENT,
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

export const INVITATION_TTL_HOURS = 48;
