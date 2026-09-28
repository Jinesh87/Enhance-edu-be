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
import { VariableExpenseHead } from "./VariableExpenseHead.js";

/**
 * One logged amount under a variable expense head. Title and category are
 * copied from the head so ledgers and exports can read them directly.
 */
@Entity("variable_expenses")
export class VariableExpense {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid", nullable: true })
  @Index()
  headId!: string | null;

  @ManyToOne(() => VariableExpenseHead, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "headId" })
  head!: Relation<VariableExpenseHead> | null;

  @Column({ type: "varchar", length: 160 })
  title!: string;

  @Column({ type: "varchar", length: 60 })
  @Index()
  category!: string;

  @Column({ type: "numeric", precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: "varchar", length: 8, default: "AUD" })
  currency!: string;

  @Column({ type: "date" })
  @Index()
  expenseDate!: string;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ type: "uuid", nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
