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

export type CommunicationChannel = "email";

export type CommunicationDraftStatus =
  | "draft"
  | "sending"
  | "sent"
  | "partially_sent"
  | "failed"
  | "cancelled";

export type CommunicationRecipientStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped";

/**
 * Filter-first audience intent.
 * AI supplies structured filters; backend resolves recipients from DB relationships.
 * Legacy `type` presets are normalized into roles/groups on sanitize.
 */
export type CommunicationAudience = {
  roles?: string[] | null;
  groups?: string[] | null;
  recipientOf?: "SELF" | "PARENTS" | null;
  status?: string | null;
  yearLevel?: string | null;
  term?: string | null;
  subject?: string | null;
  className?: string | null;
  date?: string | null;
  nameQuery?: string | null;
  userIds?: string[] | null;
  assessmentQuery?: string | null;
  enquiryStage?: string | null;
  /** Human-readable audience summary for preview UI. */
  label?: string | null;
  ambiguous?: boolean;
  confirmed?: boolean;
  options?: CommunicationAudienceOption[] | null;
  /** @deprecated Legacy preset — expanded into roles/groups during sanitize. */
  type?: string | null;
};

export type CommunicationAudienceOption = {
  label: string;
  roles?: string[] | null;
  groups?: string[] | null;
  recipientOf?: "SELF" | "PARENTS" | null;
  /** Legacy option type (normalized into roles/groups). */
  type?: string | null;
};

/**
 * Server-side recipient snapshot for drafts.
 * Raw email/phone are NEVER stored here — resolved at send-time only.
 */
export type CommunicationRecipientSnapshot = {
  userId: string;
  name: string;
  hasEmail: boolean;
  role?: string | null;
  studentNames?: string[];
  /** Human relationship hint when known (e.g. Guardian). */
  relationshipLabel?: string | null;
  /** Admin can deselect before Confirm Send. Default true. */
  selected?: boolean;
  status: CommunicationRecipientStatus;
  errorReason?: string | null;
  providerMessageId?: string | null;
};

export type CommunicationAttachmentRef = {
  fileId: string;
  name: string;
};

@Entity("admin_ai_communication_drafts")
@Index(["ownerUserId", "updatedAt"])
export class AdminAiCommunicationDraft {
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

  @Column({ type: "varchar", length: 16, default: "email" })
  channel!: CommunicationChannel;

  @Column({ type: "varchar", length: 240 })
  subject!: string;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "jsonb" })
  audience!: CommunicationAudience;

  @Column({ type: "jsonb", nullable: true })
  recipientsSnapshot!: CommunicationRecipientSnapshot[] | null;

  @Column({ type: "jsonb", nullable: true })
  attachments!: CommunicationAttachmentRef[] | null;

  @Column({ type: "int", default: 0 })
  recipientCount!: number;

  @Column({ type: "int", default: 0 })
  sentCount!: number;

  @Column({ type: "int", default: 0 })
  failedCount!: number;

  @Column({ type: "varchar", length: 24, default: "draft" })
  status!: CommunicationDraftStatus;

  @Column({ type: "boolean", default: false })
  requiresReauth!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  previewedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
