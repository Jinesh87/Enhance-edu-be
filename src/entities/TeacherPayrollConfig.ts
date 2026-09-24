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
import { User } from "./User.js";

export enum PayrollPayBasis {
  HOURLY = "HOURLY",
  DAILY = "DAILY",
  WEEKLY = "WEEKLY",
  MONTHLY = "MONTHLY",
}

@Entity("teacher_payroll_configs")
export class TeacherPayrollConfig {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid", unique: true })
  @Index()
  teacherUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "teacherUserId" })
  teacher!: Relation<User>;

  @Column({
    type: "enum",
    enum: PayrollPayBasis,
    default: PayrollPayBasis.HOURLY,
  })
  payBasis!: PayrollPayBasis;

  /** Pay amount in institution currency units (e.g. AUD). */
  @Column({ type: "numeric", precision: 12, scale: 2 })
  rate!: string;

  @Column({ type: "varchar", length: 8, default: "AUD" })
  currency!: string;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
