import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { PendingEnrollment } from "./PendingEnrollment.js";
import { Subject } from "./Subject.js";

@Entity("pending_enrollment_subjects")
@Unique(["pendingEnrollmentId", "subjectId"])
export class PendingEnrollmentSubject {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  pendingEnrollmentId!: string;

  @ManyToOne(() => PendingEnrollment, (row) => row.subjects, {
    onDelete: "CASCADE",
  })
  pendingEnrollment!: PendingEnrollment;

  @Column({ type: "uuid" })
  @Index()
  subjectId!: string;

  @ManyToOne(() => Subject, { onDelete: "RESTRICT" })
  subject!: Subject;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
