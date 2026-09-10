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

@Entity("admin_ai_report_drafts")
@Index(["ownerUserId", "updatedAt"])
export class AdminAiReportDraft {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  ownerUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ownerUserId" })
  owner!: Relation<User>;

  @Column({ type: "uuid", nullable: true })
  threadId!: string | null;

  @Column({ type: "varchar", length: 64 })
  reportType!: string;

  @Column({ type: "jsonb", nullable: true })
  filters!: Record<string, unknown> | null;

  /** Allowlisted column keys selected for preview/PDF. Null = all default columns. */
  @Column({ type: "jsonb", nullable: true })
  columns!: string[] | null;

  @Column({ type: "varchar", length: 240 })
  title!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
