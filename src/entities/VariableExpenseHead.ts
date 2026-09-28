import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/** A named variable expense (e.g. "Electricity"); amounts are logged under it. */
@Entity("variable_expense_heads")
export class VariableExpenseHead {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 160 })
  title!: string;

  @Column({ type: "varchar", length: 60 })
  @Index()
  category!: string;

  @Column({ type: "uuid", nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
