import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { Student } from "./Student.js";
import { User } from "./User.js";

export const MEETING_REQUEST_STATUSES = [
  "PENDING_ADMIN",
  "PENDING_TEACHER",
  "PENDING_GUARDIAN",
  "SCHEDULED",
  "REJECTED",
  "DECLINED",
  "CANCELLED",
] as const;

export type MeetingRequestStatus = (typeof MEETING_REQUEST_STATUSES)[number];

export type MeetingInitiator = "GUARDIAN" | "TEACHER";

/** Statuses that still hold the requested time on the teacher's schedule. */
export const ACTIVE_MEETING_STATUSES: MeetingRequestStatus[] = [
  "PENDING_ADMIN",
  "PENDING_TEACHER",
  "PENDING_GUARDIAN",
  "SCHEDULED",
];

/**
 * A Google Meet request between a guardian and a teacher, started by either side. When the
 * institution requires it, a Super Admin approves first; the Meet (always on the teacher's
 * calendar) is only created once the other side accepts.
 */
@Entity("meeting_requests")
export class MeetingRequest {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  guardianUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "guardianUserId" })
  guardian!: Relation<User>;

  @Column({ type: "uuid" })
  @Index()
  teacherUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "teacherUserId" })
  teacher!: Relation<User>;

  @Column({ type: "uuid", nullable: true })
  @Index()
  studentId!: string | null;

  @ManyToOne(() => Student, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "studentId" })
  student!: Relation<Student> | null;

  @Column({ type: "timestamptz" })
  @Index()
  startAt!: Date;

  @Column({ type: "timestamptz" })
  endAt!: Date;

  @Column({ type: "varchar", length: 64 })
  timeZone!: string;

  @Column({ type: "varchar", length: 200 })
  topic!: string;

  @Column({ type: "text", nullable: true })
  note!: string | null;

  @Column({ type: "varchar", length: 20 })
  @Index()
  status!: MeetingRequestStatus;

  @Column({ type: "varchar", length: 10, default: "GUARDIAN" })
  initiatedBy!: MeetingInitiator;

  /** Set once a teacher's request is visible to the guardian (immediately, or after admin approval). */
  @Column({ type: "timestamptz", nullable: true })
  sentToGuardianAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  guardianRespondedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  guardianNote!: string | null;

  @Column({ type: "uuid", nullable: true })
  adminReviewedById!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  adminReviewedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  adminNote!: string | null;

  /** Set once the request is visible to the teacher (immediately, or after admin approval). */
  @Column({ type: "timestamptz", nullable: true })
  sentToTeacherAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  teacherRespondedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  teacherNote!: string | null;

  @Column({ type: "uuid", nullable: true })
  cancelledById!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  cancelledAt!: Date | null;

  @Column({ type: "text", nullable: true })
  cancelReason!: string | null;

  /** A new time the guardian proposed for a confirmed meeting; waits for the teacher. */
  @Column({ type: "timestamptz", nullable: true })
  proposedStartAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  proposedEndAt!: Date | null;

  @Column({ type: "text", nullable: true })
  proposedNote!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  proposedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  rescheduledAt!: Date | null;

  @Column({ type: "uuid", nullable: true })
  rescheduledById!: string | null;

  @Column({ type: "text", nullable: true })
  rescheduleNote!: string | null;

  /** The time before the most recent reschedule, shown as "moved from". */
  @Column({ type: "timestamptz", nullable: true })
  previousStartAt!: Date | null;

  @Column({ type: "varchar", length: 1024, nullable: true })
  googleEventId!: string | null;

  /** The guardian's own copy of the event, imported into their connected calendar. */
  @Column({ type: "varchar", length: 1024, nullable: true })
  guardianEventId!: string | null;

  @Column({ type: "varchar", length: 500, nullable: true })
  meetLink!: string | null;

  @Column({ type: "varchar", length: 1000, nullable: true })
  calendarEventLink!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
