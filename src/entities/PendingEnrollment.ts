import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { PendingEnrollmentStatus } from "../common/constants/enrollment.js";
import { Enrollment } from "./Enrollment.js";
import { Term } from "./Term.js";
import { User } from "./User.js";
import { PendingEnrollmentSubject } from "./PendingEnrollmentSubject.js";

export type EnrollmentSnapshot = {
  student: {
    id: string | null;
    fullName: string;
    preferredName: string | null;
    dateOfBirth: string | null;
    yearLevel: number | null;
    createdAt?: string | Date;
  } | null;
  term: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
  } | null;
  subjects: { id: string; name: string }[];
  fee: number;
};

@Entity("pending_enrollments")
export class PendingEnrollment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  guardianId!: string;

  @ManyToOne(() => User, (user) => user.pendingEnrollments, { onDelete: "CASCADE" })
  guardian!: Relation<User>;

  @Column({ type: "varchar", length: 120 })
  studentFullName!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  studentPreferredName!: string | null;

  @Column({ type: "date", nullable: true })
  studentDateOfBirth!: string | null;

  @Column({ type: "int", nullable: true })
  studentYearLevel!: number | null;

  @Column({ type: "uuid" })
  @Index()
  termId!: string;

  @ManyToOne(() => Term, { onDelete: "RESTRICT" })
  term!: Relation<Term>;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  fee!: string;

  @Column({
    type: "enum",
    enum: PendingEnrollmentStatus,
    default: PendingEnrollmentStatus.PENDING,
  })
  @Index()
  status!: PendingEnrollmentStatus;

  @Column({ type: "uuid", nullable: true })
  fulfilledStudentId!: string | null;

  @Column({ type: "uuid", nullable: true })
  fulfilledEnrollmentId!: string | null;

  @Column({ type: "uuid", nullable: true })
  @Index()
  replacesEnrollmentId!: string | null;

  @ManyToOne(() => Enrollment, { nullable: true, onDelete: "CASCADE" })
  replacesEnrollment!: Relation<Enrollment> | null;

  @Column({ type: "jsonb", nullable: true })
  previousSnapshot!: EnrollmentSnapshot | null;

  @Column({ type: "uuid", nullable: true })
  createdByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  createdByUser!: Relation<User> | null;

  @OneToMany(() => PendingEnrollmentSubject, (row) => row.pendingEnrollment)
  subjects!: Relation<PendingEnrollmentSubject>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
