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
import { User } from "./User.js";

export const NOTIFICATION_TYPES = [
  "SESSION_UPDATED",
  "SESSION_DELETED",
  "SESSION_REMINDER_1H",
  "SESSION_REMINDER_DIGEST",
  "TERM_SCHEDULE_PUBLISHED",
  "ENROLLMENT_ACCEPTED",
  "ENROLLMENT_PENDING",
  "ENQUIRY_CREATED",
  "TRIAL_BOOKING_CONFIRMED",
  "CLASS_ROSTER_STUDENT_ADDED",
  "HOLIDAY_REMINDER",
  "ASSESSMENT_CREATED",
  "ASSESSMENT_MARKED",
  "HOMEWORK_CREATED",
  "HOMEWORK_DUE_SOON",
  "HOMEWORK_OVERDUE",
  "HOMEWORK_GRADED",
  "HOMEWORK_SUBMITTED",
  "LEARNING_SET_PUBLISHED",
  "ATTENDANCE_MARKED",
  "ATTENDANCE_EXCEPTION",
  "ATTENDANCE_CORRECTED",
  "ADMIN_AI_BRIEFING",
  "ANNOUNCEMENT",
  "EMERGENCY_ALERT",
  "CHAT_MESSAGE",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

@Entity("notifications")
export class Notification {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: Relation<User>;

  @Column({ type: "varchar", length: 40 })
  @Index()
  type!: NotificationType;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "jsonb", nullable: true })
  data!: Record<string, unknown> | null;

  @Column({ type: "timestamptz", nullable: true })
  @Index()
  readAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
