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
import { StaffPayBasis } from "./StaffPayrollConfig.js";

export enum StaffWorkUnit {
  HOURS = "HOURS",
  DAYS = "DAYS",
}

/**
 * Manually entered work for a staff member on one date. The unit follows the
 * pay basis in effect on workDate (HOURLY → HOURS, DAILY → DAYS). The rate is
 * copied onto the entry when it is logged, so later rate changes never
 * re-price existing work.
 */
@Entity("staff_work_entries")
export class StaffWorkEntry {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  staffUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "staffUserId" })
  staff!: Relation<User>;

  @Column({ type: "date" })
  @Index()
  workDate!: string;

  @Column({ type: "varchar", length: 8 })
  unit!: StaffWorkUnit;

  @Column({ type: "numeric", precision: 8, scale: 2 })
  quantity!: string;

  /** Null only for rows logged before rates were locked; those price by date. */
  @Column({ type: "numeric", precision: 12, scale: 2, nullable: true })
  rate!: string | null;

  @Column({ type: "varchar", length: 16, nullable: true })
  payBasis!: StaffPayBasis | null;

  @Column({ type: "varchar", length: 8, nullable: true })
  currency!: string | null;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ type: "uuid", nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
