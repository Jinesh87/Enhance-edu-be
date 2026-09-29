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
  "SCHEDULED",
  "REJECTED",
  "DECLINED",
  "CANCELLED",
] as const;

export type MeetingRequestStatus = (typeof MEETING_REQUEST_STATUSES)[number];

/** Statuses that still hold the requested time on the teacher's schedule. */
export const ACTIVE_MEETING_STATUSES: MeetingRequestStatus[] = [
  "PENDING_ADMIN",
  "PENDING_TEACHER",
  "SCHEDULED",
];

/**
 * A guardian's request for a Google Meet with a teacher. When the institution requires it,
 * a Super Admin approves first; the Meet is only created once the teacher approves.
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

  @Column({ type: "varchar", length: 1024, nullable: true })
  googleEventId!: string | null;

  @Column({ type: "varchar", length: 500, nullable: true })
  meetLink!: string | null;

  @Column({ type: "varchar", length: 1000, nullable: true })
  calendarEventLink!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
