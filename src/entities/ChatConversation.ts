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
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User.js";
import { ChatMessage } from "./ChatMessage.js";

export type ChatConversationKind =
  | "STUDENT_TEACHER"
  | "GUARDIAN_TEACHER"
  | "TEACHER_TEACHER";

@Entity("chat_conversations")
@Index(["studentUserId", "lastMessageAt"])
@Index(["teacherUserId", "lastMessageAt"])
@Index(["guardianUserId", "lastMessageAt"])
@Index(["peerTeacherUserId", "lastMessageAt"])
export class ChatConversation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** STUDENT_TEACHER, GUARDIAN_TEACHER, or TEACHER_TEACHER. */
  @Column({ type: "varchar", length: 32, default: "STUDENT_TEACHER" })
  kind!: ChatConversationKind;

  /** Student user id for student–teacher chats; null otherwise. */
  @Column({ type: "uuid", nullable: true })
  @Index()
  studentUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "studentUserId" })
  studentUser!: Relation<User> | null;

  /**
   * Staff participant for student/guardian chats, or the ordered first
   * teacher for TEACHER_TEACHER (lexicographically smaller user id).
   */
  @Column({ type: "uuid" })
  @Index()
  teacherUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "teacherUserId" })
  teacherUser!: Relation<User>;

  /** Guardian user id for guardian–teacher chats; null otherwise. */
  @Column({ type: "uuid", nullable: true })
  @Index()
  guardianUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "guardianUserId" })
  guardianUser!: Relation<User> | null;

  /**
   * Second staff participant for TEACHER_TEACHER chats (lexicographically
   * larger user id); null for other kinds.
   */
  @Column({ type: "uuid", nullable: true })
  @Index()
  peerTeacherUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "peerTeacherUserId" })
  peerTeacherUser!: Relation<User> | null;

  @Column({ type: "timestamptz", nullable: true })
  lastMessageAt!: Date | null;

  /** When set, the student participant has muted this chat. */
  @Column({ type: "timestamptz", nullable: true })
  studentMutedAt!: Date | null;

  /** When set, the teacher participant has muted this chat. */
  @Column({ type: "timestamptz", nullable: true })
  teacherMutedAt!: Date | null;

  /** When set, the guardian participant has muted this chat. */
  @Column({ type: "timestamptz", nullable: true })
  guardianMutedAt!: Date | null;

  /** When set, the peer teacher (TEACHER_TEACHER) has muted this chat. */
  @Column({ type: "timestamptz", nullable: true })
  peerTeacherMutedAt!: Date | null;

  /** Clear-for-me: student no longer sees messages at/before this time. */
  @Column({ type: "timestamptz", nullable: true })
  studentClearedAt!: Date | null;

  /** Clear-for-me: teacher no longer sees messages at/before this time. */
  @Column({ type: "timestamptz", nullable: true })
  teacherClearedAt!: Date | null;

  /** Clear-for-me: guardian no longer sees messages at/before this time. */
  @Column({ type: "timestamptz", nullable: true })
  guardianClearedAt!: Date | null;

  /** Clear-for-me: peer teacher no longer sees messages at/before this time. */
  @Column({ type: "timestamptz", nullable: true })
  peerTeacherClearedAt!: Date | null;

  @OneToMany(() => ChatMessage, (message) => message.conversation)
  messages!: Relation<ChatMessage>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
