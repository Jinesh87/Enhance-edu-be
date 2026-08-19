import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export type AuditAction =
  | "CREATED"
  | "EDITED"
  | "DELETED"
  | "APPROVED"
  | "EXPORTED"
  | "DENIED";

export type AuditActorKind = "PERSON" | "PROCESS";

@Entity({ name: "change_history", schema: "audit" })
export class AuditChange {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 16, unique: true })
  @Index()
  reference!: string;

  @Column({ type: "varchar", length: 12 })
  actorKind!: AuditActorKind;

  @Column({ type: "uuid", nullable: true })
  actorUserId!: string | null;

  @Column({ type: "varchar", length: 160 })
  actorName!: string;

  @Column({ type: "varchar", length: 16 })
  @Index()
  action!: AuditAction;

  @Column({ type: "varchar", length: 40 })
  @Index()
  recordType!: string;

  @Column({ type: "varchar", length: 64, nullable: true })
  recordId!: string | null;

  @Column({ type: "varchar", length: 240 })
  recordLabel!: string;

  @Column({ type: "varchar", length: 240, nullable: true })
  recordPath!: string | null;

  @Column({ type: "jsonb", nullable: true })
  before!: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  after!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamptz" })
  @Index()
  createdAt!: Date;
}
