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

export type AdminAiMemoryKind = "preference" | "default_filter";

@Entity("admin_ai_memories")
@Index(["ownerUserId", "createdAt"])
export class AdminAiMemory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  ownerUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ownerUserId" })
  owner!: Relation<User>;

  /** Sanitised preference text only — never secrets/PII. */
  @Column({ type: "varchar", length: 500 })
  content!: string;

  @Column({ type: "varchar", length: 32, default: "preference" })
  kind!: AdminAiMemoryKind;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
