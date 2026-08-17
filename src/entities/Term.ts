import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { AcademicYear } from "./AcademicYear.js";
import { YearLevel } from "./YearLevel.js";

@Entity("terms")
export class Term {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @ManyToOne(() => AcademicYear, { nullable: true, onDelete: "SET NULL" })
  academicYear!: AcademicYear | null;

  @ManyToOne(() => YearLevel, { nullable: true, onDelete: "SET NULL" })
  yearLevel!: YearLevel | null;

  @Column({ type: "date" })
  startDate!: string;

  @Column({ type: "date" })
  endDate!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
