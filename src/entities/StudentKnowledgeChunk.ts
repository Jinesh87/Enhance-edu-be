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
import { Student } from "./Student.js";

export const STUDENT_KNOWLEDGE_SOURCE_TYPES = [
  "enrollment",
  "assessment",
  "homework",
  "attendance",
  "summary",
  "timetable",
] as const;

export type StudentKnowledgeSourceType =
  (typeof STUDENT_KNOWLEDGE_SOURCE_TYPES)[number];

@Entity("student_knowledge_chunks")
@Index(["studentId", "sourceType", "sourceId"], { unique: true })
@Index(["studentId", "updatedAt"])
export class StudentKnowledgeChunk {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** Student entity id (students.id), not user id */
  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => Student, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentId" })
  student!: Relation<Student>;

  @Column({ type: "varchar", length: 40 })
  sourceType!: StudentKnowledgeSourceType;

  @Column({ type: "varchar", length: 120 })
  sourceId!: string;

  @Column({ type: "varchar", length: 160, nullable: true })
  sourceLabel!: string | null;

  @Column({ type: "text" })
  content!: string;

  /** Optional calendar day for attendance / schedule chunks (YYYY-MM-DD) */
  @Column({ type: "date", nullable: true })
  occurredOn!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
