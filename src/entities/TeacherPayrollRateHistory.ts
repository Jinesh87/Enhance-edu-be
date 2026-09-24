import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from "typeorm";
import { User } from "./User.js";
import { PayrollPayBasis } from "./TeacherPayrollConfig.js";

/**
 * Append-only rate history. A session uses the row where
 * effectiveFrom <= sessionLocalDate < effectiveTo (null effectiveTo = open-ended).
 */
@Entity("teacher_payroll_rate_history")
export class TeacherPayrollRateHistory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  teacherUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "teacherUserId" })
  teacher!: Relation<User>;

  @Column({
    type: "enum",
    enum: PayrollPayBasis,
    enumName: "teacher_payroll_configs_paybasis_enum",
  })
  payBasis!: PayrollPayBasis;

  @Column({ type: "numeric", precision: 12, scale: 2 })
  rate!: string;

  @Column({ type: "varchar", length: 8, default: "AUD" })
  currency!: string;

  /** Inclusive start date (YYYY-MM-DD) in the institution class timezone. */
  @Column({ type: "date" })
  @Index()
  effectiveFrom!: string;

  /**
   * Exclusive end date (YYYY-MM-DD). Null means this rate is still current.
   */
  @Column({ type: "date", nullable: true })
  effectiveTo!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
