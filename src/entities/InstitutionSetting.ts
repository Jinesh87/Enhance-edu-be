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

  /** OpenAI API key for institution AI features. */
  @Column({ type: "varchar", length: 255, nullable: true })
  openaiApiKey!: string | null;

  /**
   * When true, session edit/delete also sends email to teacher, students,
   * and eligible guardians (in addition to in-app SSE notifications).
   */
  @Column({ type: "boolean", default: false })
  sessionChangeEmailNotificationsEnabled!: boolean;

  // ── Admin AI capability controls (institution-wide; does not affect other AIs) ──

  @Column({ type: "boolean", default: true })
  adminAiAssistantEnabled!: boolean;

  @Column({ type: "boolean", default: true })
  adminAiDataInsightsEnabled!: boolean;

  @Column({ type: "boolean", default: true })
  adminAiEmailDraftingEnabled!: boolean;

  @Column({ type: "boolean", default: true })
  adminAiMessageDraftingEnabled!: boolean;

  @Column({ type: "boolean", default: true })
  adminAiBulkCommunicationEnabled!: boolean;

  @Column({ type: "boolean", default: true })
  adminAiNotificationSuggestionsEnabled!: boolean;

  @Column({ type: "boolean", default: true })
  adminAiProactiveBriefingEnabled!: boolean;

  @Column({ type: "boolean", default: true })
  adminAiReportBuilderEnabled!: boolean;

  @Column({ type: "boolean", default: true })
  adminAiDeepLinksEnabled!: boolean;

  @Column({ type: "boolean", default: true })
  adminAiConfirmedActionsEnabled!: boolean;

  /** Schedule/sections for Admin AI proactive briefings (no timezone picker). */
  @Column({ type: "jsonb", nullable: true })
  adminAiBriefingConfig!: {
    time?: string | null;
    daysOfWeek?: number[] | null;
    sections?: string[] | null;
  } | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
