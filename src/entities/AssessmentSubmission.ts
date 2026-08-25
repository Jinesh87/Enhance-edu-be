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
import { Assessment } from "./Assessment.js";
import { AssessmentSubmissionFile } from "./AssessmentSubmissionFile.js";
import { User } from "./User.js";

export const SUBMISSION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "PROCESSING",
  "READY",
  "FAILED",
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

@Entity("assessment_submissions")
@Index(["assessmentId", "studentId"], { unique: true })
export class AssessmentSubmission {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  assessmentId!: string;

  @ManyToOne(() => Assessment, { onDelete: "CASCADE" })
  @JoinColumn({ name: "assessmentId" })
  assessment!: Relation<Assessment>;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentId" })
  student!: Relation<User>;

  @Column({ type: "varchar", length: 20, default: "DRAFT" })
  @Index()
  status!: SubmissionStatus;

  @Column({ type: "timestamptz", nullable: true })
  submittedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  extractedText!: string | null;

  @Column({ type: "text", nullable: true })
  ocrError!: string | null;

  @OneToMany(() => AssessmentSubmissionFile, (row) => row.submission)
  files!: Relation<AssessmentSubmissionFile>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
