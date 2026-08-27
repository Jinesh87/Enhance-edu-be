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
import { AssessmentSubmission } from "./AssessmentSubmission.js";

@Entity("assessment_submission_files")
export class AssessmentSubmissionFile {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  submissionId!: string;

  @ManyToOne(() => AssessmentSubmission, (row) => row.files, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "submissionId" })
  submission!: Relation<AssessmentSubmission>;

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

  @Column({ type: "text", nullable: true })
  extractedText!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
