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

export type AdminAiReportStatus = "READY" | "FAILED";

@Entity("admin_ai_reports")
@Index(["ownerUserId", "createdAt"])
export class AdminAiReport {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  ownerUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ownerUserId" })
  owner!: Relation<User>;

  @Column({ type: "varchar", length: 64 })
  reportType!: string;

  @Column({ type: "varchar", length: 16, default: "PDF" })
  format!: string;

  @Column({ type: "jsonb", nullable: true })
  filters!: Record<string, unknown> | null;

  @Column({ type: "varchar", length: 240 })
  title!: string;

  @Column({ type: "varchar", length: 512, nullable: true })
  storageKey!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  fileName!: string | null;

  @Column({ type: "int", nullable: true })
  byteSize!: number | null;

  @Column({ type: "varchar", length: 20, default: "READY" })
  status!: AdminAiReportStatus;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
