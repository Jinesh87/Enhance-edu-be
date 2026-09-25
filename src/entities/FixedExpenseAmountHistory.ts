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
import { FixedExpense } from "./FixedExpense.js";

/**
 * Append-only amount history. An occurrence uses the row where
 * effectiveFrom <= occurrenceDate < effectiveTo (null effectiveTo = open-ended).
 */
@Entity("fixed_expense_amount_history")
export class FixedExpenseAmountHistory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  fixedExpenseId!: string;

  @ManyToOne(() => FixedExpense, { onDelete: "CASCADE" })
  @JoinColumn({ name: "fixedExpenseId" })
  fixedExpense!: Relation<FixedExpense>;

  @Column({ type: "numeric", precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: "date" })
  effectiveFrom!: string;

  @Column({ type: "date", nullable: true })
  effectiveTo!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
