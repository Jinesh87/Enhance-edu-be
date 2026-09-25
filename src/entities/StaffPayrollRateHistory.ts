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
import { StaffPayBasis } from "./StaffPayrollConfig.js";

/**
 * Append-only rate history. A work entry uses the row where
 * effectiveFrom <= workDate < effectiveTo (null effectiveTo = open-ended).
 */
@Entity("staff_payroll_rate_history")
export class StaffPayrollRateHistory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  staffUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "staffUserId" })
  staff!: Relation<User>;

  @Column({ type: "varchar", length: 16 })
  payBasis!: StaffPayBasis;

  @Column({ type: "numeric", precision: 12, scale: 2 })
  rate!: string;

  @Column({ type: "varchar", length: 8, default: "AUD" })
  currency!: string;

  /** Inclusive start date (YYYY-MM-DD). */
  @Column({ type: "date" })
  effectiveFrom!: string;

  /** Exclusive end date (YYYY-MM-DD). Null means this rate is still current. */
  @Column({ type: "date", nullable: true })
  effectiveTo!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
