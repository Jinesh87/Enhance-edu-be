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
import { HomeworkSubmission } from "./HomeworkSubmission.js";

@Entity("homework_submission_files")
export class HomeworkSubmissionFile {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  submissionId!: string;

  @ManyToOne(() => HomeworkSubmission, (submission) => submission.files, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "submissionId" })
  submission!: Relation<HomeworkSubmission>;

  @Column({ type: "varchar", length: 500 })
  storageKey!: string;

  @Column({ type: "varchar", length: 255 })
  originalName!: string;

  @Column({ type: "varchar", length: 120 })
  mimeType!: string;

  @Column({ type: "integer", default: 0 })
  byteSize!: number;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
