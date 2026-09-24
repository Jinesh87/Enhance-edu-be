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

  /** When true, guardians and teachers can message each other in-app. */
  @Column({ type: "boolean", default: false })
  guardianTeacherChatEnabled!: boolean;

  /**
   * When true, teachers who share the same year level and term can
   * message each other in-app.
   */
  @Column({ type: "boolean", default: false })
  teacherTeacherChatEnabled!: boolean;

  /** When true, guardians and Super Admins can message each other in-app. */
  @Column({ type: "boolean", default: false })
  guardianAdminChatEnabled!: boolean;

  /**
   * When true, office staff can message other office staff in-app.
   */
  @Column({ type: "boolean", default: false })
  officeStaffChatEnabled!: boolean;

  /** When true, students and Super Admins can message each other in-app. */
  @Column({ type: "boolean", default: false })
  studentAdminChatEnabled!: boolean;

  /** When true, office staff and teachers can message each other in-app. */
  @Column({ type: "boolean", default: false })
  officeTeacherChatEnabled!: boolean;

  /** When true, office staff and Super Admins can message each other in-app. */
  @Column({ type: "boolean", default: false })
  officeAdminChatEnabled!: boolean;

  /** When true, teachers and Super Admins can message each other in-app. */
  @Column({ type: "boolean", default: false })
  teacherAdminChatEnabled!: boolean;

  /** When true, teacher payroll module is available in the admin console. */
  @Column({ type: "boolean", default: false })
  teacherPayrollEnabled!: boolean;

  /** OpenAI API key for institution AI features. */
  @Column({ type: "varchar", length: 255, nullable: true })
  openaiApiKey!: string | null;

  /**
   * When true, session edit/delete also sends email to teacher, students,
   * and eligible guardians (in addition to in-app SSE notifications).
   * Urgent (<4h) cancel/reschedule always emails regardless of this flag.
   */
  @Column({ type: "boolean", default: false })
  sessionChangeEmailNotificationsEnabled!: boolean;

  /** When true, send one evening email digest listing tomorrow's classes. */
  @Column({ type: "boolean", default: true })
  classReminderDigestEnabled!: boolean;

  /** When true, send web-push ~1 hour before each class session. */
  @Column({ type: "boolean", default: true })
  classReminder1hPushEnabled!: boolean;

  /** Local hour (0–23) to send the evening class digest. Default 19. */
  @Column({ type: "smallint", default: 19 })
  classReminderDigestHour!: number;

  /**
   * When true, cancel/reschedule within 4 hours of start also sends SMS
   * (requires Twilio SMS enabled).
   */
  @Column({ type: "boolean", default: true })
  urgentCancelSmsEnabled!: boolean;

  /**
   * When true, bulk term schedule publish (bulk-replace) sends one consolidated
   * in-app + email per student/tutor/parent with their term timetable.
   */
  @Column({ type: "boolean", default: true })
  termScheduleEmailNotificationsEnabled!: boolean;

  /**
   * When true, tutor ABSENT/LATE marks send in-app + push to guardians.
   * Default on.
   */
  @Column({ type: "boolean", default: true })
  absenceAlertInAppEnabled!: boolean;

  /** When true, tutor ABSENT marks also email guardians. */
  @Column({ type: "boolean", default: true })
  absenceAlertEmailEnabled!: boolean;

  /**
   * When true, tutor ABSENT marks also SMS guardians
   * (requires Twilio SMS enabled).
   */
  @Column({ type: "boolean", default: true })
  absenceAlertSmsEnabled!: boolean;

  /** When true, new homework assigned notifies students in-app (+ push fanout). */
  @Column({ type: "boolean", default: true })
  homeworkCreatedInAppEnabled!: boolean;

  /** When true, due-soon reminder notifies pending students (in-app + push). */
  @Column({ type: "boolean", default: true })
  homeworkDueSoonEnabled!: boolean;

  /**
   * When true, overdue homework notifies student and parents in-app (+ push).
   */
  @Column({ type: "boolean", default: true })
  homeworkOverdueInAppEnabled!: boolean;

  /** When true, overdue homework also emails parents. */
  @Column({ type: "boolean", default: true })
  homeworkOverdueEmailEnabled!: boolean;

  /** When true, graded/feedback notifies the student (in-app + push). */
  @Column({ type: "boolean", default: true })
  homeworkGradedEnabled!: boolean;

  /** When true, successful submission notifies the tutor in-app. */
  @Column({ type: "boolean", default: true })
  homeworkSubmittedEnabled!: boolean;

  /** When true, new enquiry capture notifies admins/office (in-app + email). */
  @Column({ type: "boolean", default: true })
  enquiryCreatedNotifyEnabled!: boolean;

  /**
   * When true, trial booking confirmation notifies parent + student
   * (in-app + email + SMS).
   */
  @Column({ type: "boolean", default: true })
  trialBookingConfirmedNotifyEnabled!: boolean;

  /**
   * When true, enrolment accept notifies parent + student (in-app + email).
   */
  @Column({ type: "boolean", default: true })
  enrollmentAcceptedNotifyEnabled!: boolean;

  /** When true, new class roster add notifies the tutor in-app. */
  @Column({ type: "boolean", default: true })
  classRosterStudentAddedNotifyEnabled!: boolean;

  /**
   * When true, holiday/closure reminders send in-app (+ push) to affected users
   * 7 days and 2 days before start.
   */
  @Column({ type: "boolean", default: true })
  holidayReminderInAppEnabled!: boolean;

  /** When true, holiday/closure reminders also email affected users. */
  @Column({ type: "boolean", default: true })
  holidayReminderEmailEnabled!: boolean;

  /** When true, general Admin AI announcements also email recipients. */
  @Column({ type: "boolean", default: true })
  announcementEmailEnabled!: boolean;

  /** When true, emergency alerts create in-app notifications (and push fan-out). */
  @Column({ type: "boolean", default: true })
  emergencyAlertInAppEnabled!: boolean;

  /** When true, emergency alerts also email recipients. */
  @Column({ type: "boolean", default: true })
  emergencyAlertEmailEnabled!: boolean;

  /** When true, emergency alerts also SMS recipients (requires Twilio). */
  @Column({ type: "boolean", default: true })
  emergencyAlertSmsEnabled!: boolean;

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

  /** Schedule/sections for Admin AI proactive briefings. */
  @Column({ type: "jsonb", nullable: true })
  adminAiBriefingConfig!: {
    time?: string | null;
    timeZone?: string | null;
    daysOfWeek?: number[] | null;
    sections?: string[] | null;
    startDate?: string | null;
    endDate?: string | null;
    nextRunAt?: string | null;
    lastRunAt?: string | null;
  } | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
