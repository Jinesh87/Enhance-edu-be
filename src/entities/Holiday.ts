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
import { Term } from "./Term.js";

export type HolidayKind = "PUBLIC" | "TERM";

@Entity("holidays")
export class Holiday {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 20, default: "PUBLIC" })
  @Index()
  kind!: HolidayKind;

  @Column({ type: "uuid", nullable: true })
  @Index()
  termId!: string | null;

  @ManyToOne(() => Term, { nullable: true, onDelete: "CASCADE" })
  term!: Relation<Term> | null;

  @Column({ type: "date" })
  startDate!: string;

  @Column({ type: "date" })
  endDate!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
