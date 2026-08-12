import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import {
  EmploymentType,
  TwoFactorMethod,
  UserRole,
  UserStatus,
} from "../common/constants/roles.js";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  fullName!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  preferredName!: string | null;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 255 })
  email!: string;

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

  @Column({ type: "boolean", default: false })
  securitySetupComplete!: boolean;

  @Column({ type: "enum", enum: TwoFactorMethod, nullable: true })
  twoFactorMethod!: TwoFactorMethod | null;

  @Index()
  @Column({ type: "varchar", length: 255, nullable: true })
  invitationTokenHash!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  invitationExpiresAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  lastSignedInAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
