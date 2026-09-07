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
import { CoachThread } from "./CoachThread.js";

export type CoachMessageRole = "user" | "assistant";

@Entity("coach_messages")
@Index(["threadId", "createdAt"])
export class CoachMessage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  threadId!: string;

  @ManyToOne(() => CoachThread, (thread) => thread.messages, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "threadId" })
  thread!: Relation<CoachThread>;

  @Column({ type: "varchar", length: 20 })
  role!: CoachMessageRole;

  @Column({ type: "text" })
  content!: string;

  @Column({ type: "jsonb", nullable: true })
  sources!: Array<{
    syllabusId: string;
    sourceType: string;
    sourceLabel: string | null;
    excerpt: string;
  }> | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
