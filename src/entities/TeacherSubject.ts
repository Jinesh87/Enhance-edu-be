import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from "typeorm";
import { User } from "./User.js";
import { Subject } from "./Subject.js";

@Entity("teacher_subjects")
@Unique(["teacherId", "subjectId"])
export class TeacherSubject {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  teacherId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  teacher!: User;

  @Column({ type: "uuid" })
  @Index()
  subjectId!: string;

  @ManyToOne(() => Subject, { onDelete: "CASCADE" })
  subject!: Subject;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
