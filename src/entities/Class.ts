import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User.js";
import { Term } from "./Term.js";

@Entity("classes")
export class Class {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 60, default: "" })
  code!: string;

  @Column({ type: "varchar", length: 80, default: "Room 4" })
  room!: string;

  @Column({ type: "varchar", length: 120, nullable: true })
  subject!: string | null;

  @Column({ type: "varchar", length: 60, nullable: true })
  lesson!: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  dayTime!: string | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  timeZone!: string | null;

  @Column({ type: "integer", default: 20 })
  capacity!: number;

  @Column({ type: "varchar", length: 120, nullable: true })
  contentGroup!: string | null;

  @Column({ type: "varchar", length: 120, nullable: true, default: "Term 3 2026" })
  termName!: string | null;

  @ManyToOne(() => Term, { onDelete: "SET NULL", nullable: true })
  @Index()
  term!: Relation<Term> | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @Index()
  teacher!: Relation<User> | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
