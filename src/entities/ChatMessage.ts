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
import { ChatConversation } from "./ChatConversation.js";

@Entity("chat_messages")
@Index(["conversationId", "createdAt"])
export class ChatMessage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  conversationId!: string;

  @ManyToOne(() => ChatConversation, (conversation) => conversation.messages, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "conversationId" })
  conversation!: Relation<ChatConversation>;

  @Column({ type: "uuid" })
  @Index()
  senderUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "senderUserId" })
  sender!: Relation<User>;

  @Column({ type: "text" })
  body!: string;

  /**
   * 0 = plaintext (legacy). 1 = client-side E2EE (body is opaque ciphertext;
   * attachment bytes are ciphertext when present).
   */
  @Column({ type: "int", default: 0 })
  encryptionVersion!: number;

  @Column({ type: "varchar", length: 512, nullable: true })
  storageKey!: string | null;

  /** Small compressed preview for image messages (e.g. WebP). */
  @Column({ type: "varchar", length: 512, nullable: true })
  thumbnailStorageKey!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  originalName!: string | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  mimeType!: string | null;

  @Column({ type: "int", nullable: true })
  byteSize!: number | null;

  @Column({ type: "timestamptz", nullable: true })
  deliveredAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  readAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  voicePlayedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  editedAt!: Date | null;

  @Column({ type: "uuid", nullable: true })
  @Index()
  replyToMessageId!: string | null;

  @ManyToOne(() => ChatMessage, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "replyToMessageId" })
  replyToMessage!: Relation<ChatMessage> | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
