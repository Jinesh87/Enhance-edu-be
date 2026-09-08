import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("admin_ai_audit_logs")
@Index(["createdAt"])
@Index(["actorUserId", "createdAt"])
export class AdminAiAuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 64 })
  @Index()
  requestId!: string;

  @Column({ type: "uuid" })
  actorUserId!: string;

  @Column({ type: "varchar", length: 40 })
  actorRole!: string;

  @Column({ type: "uuid", nullable: true })
  conversationId!: string | null;

  @Column({ type: "varchar", length: 60 })
  eventType!: string;

  @Column({ type: "varchar", length: 20, nullable: true })
  mode!: string | null;

  @Column({ type: "jsonb", nullable: true })
  toolNames!: string[] | null;

  @Column({ type: "jsonb", nullable: true })
  scopeMetadata!: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  documentIds!: string[] | null;

  @Column({ type: "varchar", length: 40 })
  resultStatus!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  errorCode!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
