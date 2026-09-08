import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { AdminAiMessage } from "./AdminAiMessage.js";
import { User } from "./User.js";

@Entity("admin_ai_threads")
@Index(["ownerUserId", "updatedAt"])
export class AdminAiThread {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  ownerUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ownerUserId" })
  owner!: Relation<User>;

  @Column({ type: "varchar", length: 200, nullable: true })
  title!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  lastMessageAt!: Date | null;

  @OneToMany(() => AdminAiMessage, (message) => message.thread)
  messages!: Relation<AdminAiMessage[]>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ type: "timestamptz", nullable: true })
  deletedAt!: Date | null;
}
