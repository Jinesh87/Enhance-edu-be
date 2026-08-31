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
import { Homework } from "./Homework.js";
import { User } from "./User.js";

@Entity("homework_attachments")
export class HomeworkAttachment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  homeworkId!: string;

  @ManyToOne(() => Homework, (homework) => homework.attachments, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "homeworkId" })
  homework!: Relation<Homework>;

  @Column({ type: "uuid", nullable: true })
  @Index()
  uploadedById!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "uploadedById" })
  uploadedBy!: Relation<User> | null;

  @Column({ type: "varchar", length: 500 })
  storageKey!: string;

  @Column({ type: "varchar", length: 255 })
  originalName!: string;

  @Column({ type: "varchar", length: 120 })
  mimeType!: string;

  @Column({ type: "integer", default: 0 })
  byteSize!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
