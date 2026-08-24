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
import { Class } from "./Class.js";
import { Classroom } from "./Classroom.js";
import { Term } from "./Term.js";
import { User } from "./User.js";
import { AssessmentStudent } from "./AssessmentStudent.js";

export const ASSESSMENT_STATUSES = [
  "SCHEDULED",
  "COMPLETED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

@Entity("assessments")
export class Assessment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "uuid", nullable: true })
  @Index()
  classId!: string | null;

  @ManyToOne(() => Class, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "classId" })
  linkedClass!: Relation<Class> | null;

  @Column({ type: "uuid" })
  @Index()
  termId!: string;

  @ManyToOne(() => Term, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "termId" })
  term!: Relation<Term>;

  @Column({ type: "varchar", length: 120 })
  subject!: string;

  @Column({ type: "varchar", length: 80 })
  yearGroup!: string;

  @Column({ type: "date" })
  assessmentDate!: string;

  @Column({ type: "varchar", length: 5 })
  startTime!: string;

  @Column({ type: "integer" })
  durationMinutes!: number;

  @Column({ type: "uuid", nullable: true })
  @Index()
  classroomId!: string | null;

  @ManyToOne(() => Classroom, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "classroomId" })
  classroom!: Relation<Classroom> | null;

  @Column({ type: "varchar", length: 80, default: "" })
  room!: string;

  @Column({ type: "uuid", nullable: true })
  @Index()
  teacherId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "teacherId" })
  teacher!: Relation<User> | null;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ type: "varchar", length: 20, default: "SCHEDULED" })
  @Index()
  status!: AssessmentStatus;

  @OneToMany(() => AssessmentStudent, (row) => row.assessment)
  students!: Relation<AssessmentStudent>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
