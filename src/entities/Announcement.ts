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
import type { CommunicationAudience } from "./AdminAiCommunicationDraft.js";

export type AnnouncementStatus = "DRAFT" | "PUBLISHED";
export type AnnouncementDeliveryChannel = "IN_APP";

@Entity("announcements")
export class Announcement {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Column({ type: "text" })
  message!: string;

  @Column({ type: "uuid" })
  @Index()
  createdBy!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "createdBy" })
  creator!: Relation<User>;

  @Column({ type: "uuid" })
  @Index()
  approvedBy!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "approvedBy" })
  approver!: Relation<User>;

  @Column({ type: "timestamptz" })
  @Index()
  publishedAt!: Date;

  @Column({ type: "varchar", length: 24, default: "PUBLISHED" })
  status!: AnnouncementStatus;

  @Column({ type: "jsonb" })
  audienceSnapshot!: CommunicationAudience;

  @Column({ type: "int", default: 0 })
  recipientCount!: number;

  @Column({ type: "varchar", length: 24, default: "IN_APP" })
  deliveryChannel!: AnnouncementDeliveryChannel;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
