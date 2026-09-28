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
import { Session } from "./Session.js";
import { Student } from "./Student.js";
import { User } from "./User.js";

/** A guardian's rating of a finished class session their student attended. */
@Entity("class_feedback")
@Unique(["sessionId", "studentId", "guardianUserId"])
export class ClassFeedback {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: "CASCADE" })
  @JoinColumn({ name: "sessionId" })
  session!: Relation<Session>;

  @Column({ type: "uuid", nullable: true })
  @Index()
  classId!: string | null;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => Student, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentId" })
  student!: Relation<Student>;

  @Column({ type: "uuid" })
  @Index()
  guardianUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "guardianUserId" })
  guardian!: Relation<User>;

  @Column({ type: "smallint" })
  rating!: number;

  @Column({ type: "text", nullable: true })
  comment!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
