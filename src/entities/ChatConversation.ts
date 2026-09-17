import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User.js";
import { ChatMessage } from "./ChatMessage.js";

@Entity("chat_conversations")
@Unique(["studentUserId", "teacherUserId"])
@Index(["studentUserId", "lastMessageAt"])
@Index(["teacherUserId", "lastMessageAt"])
export class ChatConversation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  studentUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentUserId" })
  studentUser!: Relation<User>;

  @Column({ type: "uuid" })
  @Index()
  teacherUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "teacherUserId" })
  teacherUser!: Relation<User>;

  @Column({ type: "timestamptz", nullable: true })
  lastMessageAt!: Date | null;

  /** When set, the student participant has muted this chat. */
  @Column({ type: "timestamptz", nullable: true })
  studentMutedAt!: Date | null;

  /** When set, the teacher participant has muted this chat. */
  @Column({ type: "timestamptz", nullable: true })
  teacherMutedAt!: Date | null;

  @OneToMany(() => ChatMessage, (message) => message.conversation)
  messages!: Relation<ChatMessage>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
