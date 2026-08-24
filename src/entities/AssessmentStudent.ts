import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { Assessment } from "./Assessment.js";
import { User } from "./User.js";

@Entity("assessment_students")
@Unique(["assessmentId", "studentId"])
export class AssessmentStudent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  assessmentId!: string;

  @ManyToOne(() => Assessment, (assessment) => assessment.students, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "assessmentId" })
  assessment!: Relation<Assessment>;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentId" })
  student!: Relation<User>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
