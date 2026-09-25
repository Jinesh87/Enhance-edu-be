import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("variable_expenses")
export class VariableExpense {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

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
