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
import { Homework } from "./Homework.js";
import { HomeworkSubmissionFile } from "./HomeworkSubmissionFile.js";
import { User } from "./User.js";

export type HomeworkSubmissionStatus = "DRAFT" | "SUBMITTED";

@Entity("homework_submissions")
@Unique(["homeworkId", "studentId"])
export class HomeworkSubmission {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  homeworkId!: string;

  @ManyToOne(() => Homework, (homework) => homework.submissions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "homeworkId" })
  homework!: Relation<Homework>;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentId" })
  student!: Relation<User>;

  @Column({ type: "varchar", length: 32, default: "DRAFT" })
  status!: HomeworkSubmissionStatus;

  @Column({ type: "timestamptz", nullable: true })
  submittedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  studentNotes!: string | null;

  @Column({ type: "numeric", precision: 5, scale: 2, nullable: true })
  marks!: number | null;

  @Column({ type: "numeric", precision: 5, scale: 2, nullable: true, default: 100 })
  maxMarks!: number | null;

  @Column({ type: "text", nullable: true })
  feedback!: string | null;

  @Column({ type: "boolean", default: false })
  isCompleted!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  markedAt!: Date | null;

  @Column({ type: "uuid", nullable: true })
  @Index()
  markedById!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "markedById" })
  markedBy!: Relation<User> | null;

  @OneToMany(() => HomeworkSubmissionFile, (file) => file.submission)
  files!: Relation<HomeworkSubmissionFile>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
