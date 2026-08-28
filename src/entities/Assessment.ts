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
import { AssessmentResource } from "./AssessmentResource.js";

export const ASSESSMENT_STATUSES = [
  "SCHEDULED",
  "LIVE",
  "COMPLETED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const ASSESSMENT_KINDS = ["SCHOOL", "ENTRANCE"] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export const ASSESSMENT_SCHEDULE_TYPES = ["SESSION", "FULL_DAY"] as const;
export type AssessmentScheduleType =
  (typeof ASSESSMENT_SCHEDULE_TYPES)[number];

@Entity("assessments")
export class Assessment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 20, default: "SCHOOL" })
  @Index()
  kind!: AssessmentKind;

  @Column({ type: "varchar", length: 20, default: "SESSION" })
  scheduleType!: AssessmentScheduleType;

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

  /** Entrance exams only — maximum mark for the paper. */
  @Column({ type: "numeric", precision: 8, scale: 2, nullable: true })
  totalMarks!: string | null;

  /** Entrance exams only — pass / offer cut-off mark. */
  @Column({ type: "numeric", precision: 8, scale: 2, nullable: true })
  cutOffMarks!: string | null;

  @Column({ type: "boolean", default: false })
  autoMarking!: boolean;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ type: "varchar", length: 20, default: "SCHEDULED" })
  @Index()
  status!: AssessmentStatus;

  @OneToMany(() => AssessmentStudent, (row) => row.assessment)
  students!: Relation<AssessmentStudent>[];

  @OneToMany(() => AssessmentResource, (row) => row.assessment)
  resources!: Relation<AssessmentResource>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
