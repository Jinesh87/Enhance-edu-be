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
import { Assessment } from "./Assessment.js";
import { Class } from "./Class.js";
import { Classroom } from "./Classroom.js";
import { User } from "./User.js";

@Entity("sessions")
export class Session {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Class lesson sessions require this; assessment-only sessions may be null. */
  @Column({ type: "uuid", nullable: true })
  @Index()
  classId!: string | null;

  @ManyToOne(() => Class, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "classId" })
  class!: Relation<Class> | null;

  /** When set, this session is the roll/check-in window for an assessment. */
  @Column({ type: "uuid", nullable: true, unique: true })
  @Index()
  assessmentId!: string | null;

  @ManyToOne(() => Assessment, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "assessmentId" })
  assessment!: Relation<Assessment> | null;

  @Column({ type: "timestamptz" })
  @Index()
  startAt!: Date;

  @Column({ type: "timestamptz" })
  endAt!: Date;

  @Column({ type: "varchar", length: 80, nullable: true })
  room!: string | null;

  @Column({ type: "uuid", nullable: true })
  @Index()
  classroomId!: string | null;

  @ManyToOne(() => Classroom, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "classroomId" })
  classroom!: Relation<Classroom> | null;

  /** Optional override for this occurrence only; falls back to class.teacher. */
  @Column({ type: "uuid", nullable: true })
  @Index()
  teacherId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "teacherId" })
  teacher!: Relation<User> | null;

  @Column({ type: "int", default: 25 })
  gracePeriodMinutes!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
