import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { Enrollment } from "./Enrollment.js";
import { Subject } from "./Subject.js";

@Entity("enrollment_subjects")
@Unique(["enrollmentId", "subjectId"])
export class EnrollmentSubject {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  enrollmentId!: string;

  @ManyToOne(() => Enrollment, (enrollment) => enrollment.subjects, {
    onDelete: "CASCADE",
  })
  enrollment!: Enrollment;

  @Column({ type: "uuid" })
  @Index()
  subjectId!: string;

  @ManyToOne(() => Subject, { onDelete: "RESTRICT" })
  subject!: Subject;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
