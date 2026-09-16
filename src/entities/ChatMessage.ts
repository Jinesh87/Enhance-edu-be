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

  @Column({ type: "varchar", length: 512, nullable: true })
  storageKey!: string | null;

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

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
