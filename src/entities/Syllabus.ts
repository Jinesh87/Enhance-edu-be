import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { AcademicYear } from "./AcademicYear.js";
import { Subject } from "./Subject.js";
import { YearLevel } from "./YearLevel.js";
import { SyllabusDocument } from "./SyllabusDocument.js";
import { SyllabusSkill } from "./SyllabusSkill.js";

@Entity("syllabi")
@Index(["subjectId", "academicYearId", "yearLevelId"], { unique: true })
export class Syllabus {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  subjectId!: string;

  @ManyToOne(() => Subject, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "subjectId" })
  subject!: Relation<Subject>;

  @Column({ type: "uuid" })
  @Index()
  academicYearId!: string;

  @ManyToOne(() => AcademicYear, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "academicYearId" })
  academicYear!: Relation<AcademicYear>;

  @Column({ type: "uuid" })
  @Index()
  yearLevelId!: string;

  @ManyToOne(() => YearLevel, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "yearLevelId" })
  yearLevel!: Relation<YearLevel>;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Column({ type: "text", nullable: true })
  overview!: string | null;

  @OneToMany(() => SyllabusDocument, (document) => document.syllabus)
  documents!: Relation<SyllabusDocument[]>;

  @OneToMany(() => SyllabusSkill, (skill) => skill.syllabus)
  skills!: Relation<SyllabusSkill[]>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
