import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import {
  EmploymentType,
  TwoFactorMethod,
  UserRole,
  UserStatus,
} from "../common/constants/roles.js";
import { GuardianStudent } from "./GuardianStudent.js";
import { PendingEnrollment } from "./PendingEnrollment.js";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  fullName!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  preferredName!: string | null;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 255, nullable: true })
  email!: string | null;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 50, nullable: true })
  username!: string | null;

  @Column({ type: "varchar", length: 30, nullable: true })
  mobile!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  passwordHash!: string | null;

  @Column({ type: "enum", enum: UserRole })
  role!: UserRole;

  @Column({ type: "enum", enum: UserStatus, default: UserStatus.INVITED })
  status!: UserStatus;

  @Column({ type: "enum", enum: EmploymentType, nullable: true })
  employmentType!: EmploymentType | null;

  @Column({ type: "jsonb", nullable: true })
  modulePermissions!: string[] | null;

  @Column({ type: "boolean", default: false })
  securitySetupComplete!: boolean;

  /** True when this account was provisioned while institution sandbox mode was on. */
  @Column({ type: "boolean", default: false })
  createdViaSandbox!: boolean;

  @Column({ type: "enum", enum: TwoFactorMethod, nullable: true })
  twoFactorMethod!: TwoFactorMethod | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  authenticatorSecret!: string | null;

  @Index()
  @Column({ type: "varchar", length: 255, nullable: true })
  invitationTokenHash!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  invitationExpiresAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastSignedInAt!: Date | null;

  @OneToMany(() => GuardianStudent, (link) => link.guardian)
  studentLinks!: Relation<GuardianStudent>[];

  @OneToMany(() => PendingEnrollment, (row) => row.guardian)
  pendingEnrollments!: Relation<PendingEnrollment>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
