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
import { GuardianCoachThread } from "./GuardianCoachThread.js";

export type GuardianCoachMessageRole = "user" | "assistant";

@Entity("guardian_coach_messages")
@Index(["threadId", "createdAt"])
export class GuardianCoachMessage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  threadId!: string;

  @ManyToOne(() => GuardianCoachThread, (thread) => thread.messages, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "threadId" })
  thread!: Relation<GuardianCoachThread>;

  @Column({ type: "varchar", length: 20 })
  role!: GuardianCoachMessageRole;

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
