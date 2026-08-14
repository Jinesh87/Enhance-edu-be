import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { EnrollmentStatus } from "../common/constants/enrollment.js";
import { Student } from "./Student.js";
import { Term } from "./Term.js";
import { User } from "./User.js";
import { EnrollmentSubject } from "./EnrollmentSubject.js";

@Entity("enrollments")
export class Enrollment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => Student, { onDelete: "CASCADE" })
  student!: Student;

  @Column({ type: "uuid" })
  @Index()
  guardianId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  guardian!: User;

  @Column({ type: "uuid" })
  @Index()
  termId!: string;

  @ManyToOne(() => Term, { onDelete: "RESTRICT" })
  term!: Term;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  fee!: string;

  @Column({ type: "enum", enum: EnrollmentStatus, default: EnrollmentStatus.PENDING })
  @Index()
  status!: EnrollmentStatus;

  @Column({ type: "uuid", nullable: true })
  createdByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  createdByUser!: User | null;

  @OneToMany(() => EnrollmentSubject, (row) => row.enrollment)
  subjects!: EnrollmentSubject[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
