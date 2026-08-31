import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("institution_setting")
export class InstitutionSetting {
  @PrimaryColumn({ type: "varchar", length: 50 })
  id!: string;

  @Column({ type: "double precision", nullable: true })
  latitude!: number | null;

  @Column({ type: "double precision", nullable: true })
  longitude!: number | null;

  /** When true, users with 2FA configured must enter a code at login. */
  @Column({ type: "boolean", default: false })
  login2faEnabled!: boolean;

  /**
   * When true, admins create adult accounts as ACTIVE with a password
   * (no invitation email / invitation 2FA). Student logins still go through
   * the guardian accept flow.
   */
  @Column({ type: "boolean", default: false })
  sandboxModeEnabled!: boolean;

  /** When true, guardians can view linked students' class timetable and lesson details. */
  @Column({ type: "boolean", default: false })
  guardianPortalClassDetailsEnabled!: boolean;

  /** When true, guardians can view linked students' assessments and marks. */
  @Column({ type: "boolean", default: false })
  guardianPortalAssessmentsEnabled!: boolean;

  /** When true, guardians can view linked students' entrance exam work. */
  @Column({ type: "boolean", default: false })
  guardianPortalEntranceExamsEnabled!: boolean;

  /** When true, guardians can view linked students' attendance records. */
  @Column({ type: "boolean", default: false })
  guardianPortalAttendanceEnabled!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
