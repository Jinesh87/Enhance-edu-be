import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User.js";

/** One proactive briefing per admin user per local calendar date. */
@Entity("admin_ai_briefings")
@Unique(["userId", "briefingDate"])
@Index(["userId", "createdAt"])
@Index(["userId", "readAt"])
export class AdminAiBriefing {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: Relation<User>;

  /** Local calendar date in the institution briefing timezone (YYYY-MM-DD). */
  @Column({ type: "date" })
  briefingDate!: string;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Column({ type: "text" })
  summary!: string;

  /** Sanitized aggregate snapshot used for the AI summary (no PII/secrets). */
  @Column({ type: "jsonb", nullable: true })
  snapshot!: Record<string, unknown> | null;

  @Column({ type: "timestamptz", nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
