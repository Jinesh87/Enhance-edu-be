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
  "ENROLLMENT_ACCEPTED",
  "ASSESSMENT_CREATED",
  "HOMEWORK_CREATED",
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
