import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { AcademicYear } from "./AcademicYear.js";
import { YearLevel } from "./YearLevel.js";
import { Classroom } from "./Classroom.js";

@Entity("terms")
export class Term {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @ManyToOne(() => AcademicYear, { nullable: true, onDelete: "SET NULL" })
  academicYear!: Relation<AcademicYear> | null;

  @ManyToOne(() => YearLevel, { nullable: true, onDelete: "SET NULL" })
  yearLevel!: Relation<YearLevel> | null;

  @Column({ type: "uuid", nullable: true })
  classroomId!: string | null;

  @ManyToOne(() => Classroom, { nullable: true, onDelete: "SET NULL" })
  classroom!: Relation<Classroom> | null;

  @Column({ type: "date" })
  startDate!: string;

  @Column({ type: "date" })
  endDate!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
