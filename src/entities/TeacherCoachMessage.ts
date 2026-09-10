import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from "typeorm";
import { TeacherCoachThread } from "./TeacherCoachThread.js";

export type TeacherCoachMessageRole = "user" | "assistant";

@Entity("teacher_coach_messages")
@Index(["threadId", "createdAt"])
export class TeacherCoachMessage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  threadId!: string;

  @ManyToOne(() => TeacherCoachThread, (thread) => thread.messages, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "threadId" })
  thread!: Relation<TeacherCoachThread>;

  @Column({ type: "varchar", length: 20 })
  role!: TeacherCoachMessageRole;

  @Column({ type: "text" })
  content!: string;

  @Column({ type: "jsonb", nullable: true })
  sources!: Array<{
    kind: "database" | "document";
    label: string;
    detail?: string | null;
  }> | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
