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
import { AdminAiThread } from "./AdminAiThread.js";

export type AdminAiMessageRole = "user" | "assistant";
export type AdminAiMessageStatus = "COMPLETE" | "FAILED";
export type AdminAiMode = "DATA" | "DOCUMENT" | "DRAFT" | "GENERAL";

export type AdminAiSource = {
  kind: "database" | "document" | "draft" | "action";
  label: string;
  detail?: string | null;
  /** Present when kind is "action". Never shown as a citation. */
  openPage?: {
    type: "OPEN_PAGE";
    resource: string;
    id?: string | null;
    filters?: Record<string, string>;
    label: string;
  } | null;
};

@Entity("admin_ai_messages")
@Index(["threadId", "createdAt"])
export class AdminAiMessage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  threadId!: string;

  @ManyToOne(() => AdminAiThread, (thread) => thread.messages, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "threadId" })
  thread!: Relation<AdminAiThread>;

  @Column({ type: "varchar", length: 20 })
  role!: AdminAiMessageRole;

  @Column({ type: "text" })
  content!: string;

  @Column({ type: "varchar", length: 20, default: "COMPLETE" })
  status!: AdminAiMessageStatus;

  @Column({ type: "varchar", length: 20, nullable: true })
  mode!: AdminAiMode | null;

  @Column({ type: "jsonb", nullable: true })
  sources!: AdminAiSource[] | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
