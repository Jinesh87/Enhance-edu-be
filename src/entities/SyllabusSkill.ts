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
import { Syllabus } from "./Syllabus.js";

@Entity("syllabus_skills")
export class SyllabusSkill {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  syllabusId!: string;

  @ManyToOne(() => Syllabus, (syllabus) => syllabus.skills, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "syllabusId" })
  syllabus!: Relation<Syllabus>;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "numeric", precision: 10, scale: 2, nullable: true })
  weightage!: string | null;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
