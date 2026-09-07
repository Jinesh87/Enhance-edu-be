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
import { User } from "./User.js";

export const OPENAI_USAGE_OPERATIONS = ["chat", "embedding"] as const;
export type OpenAiUsageOperation = (typeof OPENAI_USAGE_OPERATIONS)[number];

export const OPENAI_USAGE_STATUSES = ["success", "error"] as const;
export type OpenAiUsageStatus = (typeof OPENAI_USAGE_STATUSES)[number];

@Entity("openai_usage_logs")
export class OpenAiUsageLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Product feature that triggered the call, e.g. coach_chat, syllabus_embed. */
  @Column({ type: "varchar", length: 80 })
  @Index()
  feature!: string;

  @Column({ type: "varchar", length: 40 })
  @Index()
  operation!: OpenAiUsageOperation;

  @Column({ type: "varchar", length: 80 })
  @Index()
  model!: string;

  @Column({ type: "int", default: 0 })
  promptTokens!: number;

  @Column({ type: "int", default: 0 })
  completionTokens!: number;

  @Column({ type: "int", default: 0 })
  totalTokens!: number;

  /** Estimated USD cost from published list prices (approximate). */
  @Column({ type: "numeric", precision: 12, scale: 6, nullable: true })
  estimatedCostUsd!: string | null;

  @Column({ type: "varchar", length: 20, default: "success" })
  @Index()
  status!: OpenAiUsageStatus;

  @Column({ type: "varchar", length: 255, nullable: true })
  errorMessage!: string | null;

  @Column({ type: "uuid", nullable: true })
  @Index()
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "userId" })
  user!: Relation<User> | null;

  @Column({ type: "int", nullable: true })
  requestCount!: number | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamptz" })
  @Index()
  createdAt!: Date;
}
