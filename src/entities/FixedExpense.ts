import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export enum FixedExpenseFrequency {
  WEEKLY = "WEEKLY",
  MONTHLY = "MONTHLY",
  QUARTERLY = "QUARTERLY",
  YEARLY = "YEARLY",
}

/**
 * Recurring expense. Occurrences are derived from startDate + frequency and
 * priced from fixed_expense_amount_history on each occurrence date.
 */
@Entity("fixed_expenses")
export class FixedExpense {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "varchar", length: 60 })
  @Index()
  category!: string;

  @Column({ type: "varchar", length: 16 })
  frequency!: FixedExpenseFrequency;

  @Column({ type: "varchar", length: 8, default: "AUD" })
  currency!: string;

  /** First occurrence (YYYY-MM-DD); later occurrences repeat from this anchor. */
  @Column({ type: "date" })
  startDate!: string;

  /** Inclusive last date an occurrence may fall on. Null = ongoing. */
  @Column({ type: "date", nullable: true })
  endDate!: string | null;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ type: "uuid", nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
