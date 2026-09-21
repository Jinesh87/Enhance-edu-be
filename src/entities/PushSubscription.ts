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

@Entity("push_subscriptions")
export class PushSubscription {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: Relation<User>;

  @Column({ type: "text", unique: true })
  endpoint!: string;

  @Column({ type: "text" })
  p256dh!: string;

  @Column({ type: "text" })
  auth!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
