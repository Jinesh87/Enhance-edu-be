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

export enum StaffPayBasis {
  HOURLY = "HOURLY",
  DAILY = "DAILY",
}

/** Pay rate for non-teaching staff. Worked hours/days are entered manually. */
@Entity("staff_payroll_configs")
export class StaffPayrollConfig {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid", unique: true })
  @Index()
  staffUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "staffUserId" })
  staff!: Relation<User>;

  @Column({ type: "varchar", length: 16, default: StaffPayBasis.HOURLY })
  payBasis!: StaffPayBasis;

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
