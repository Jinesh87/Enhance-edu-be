import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from "typeorm";
import type { EnrollmentSnapshot } from "./PendingEnrollment.js";
import { Enrollment } from "./Enrollment.js";
import { PendingEnrollment } from "./PendingEnrollment.js";

@Entity("enrollment_versions")
export class EnrollmentVersion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  enrollmentId!: string;

  @ManyToOne(() => Enrollment, { onDelete: "CASCADE" })
  enrollment!: Relation<Enrollment>;

  @Column({ type: "int" })
  versionNumber!: number;

  @Column({ type: "jsonb" })
  snapshot!: EnrollmentSnapshot;

  @Column({ type: "uuid", nullable: true })
  pendingEnrollmentId!: string | null;

  @ManyToOne(() => PendingEnrollment, { nullable: true, onDelete: "SET NULL" })
  pendingEnrollment!: Relation<PendingEnrollment> | null;

  /** When this version was superseded by a guardian-approved change. */
  @Column({ type: "timestamptz" })
  archivedAt!: Date;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
