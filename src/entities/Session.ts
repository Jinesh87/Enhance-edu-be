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
import { Class } from "./Class.js";

@Entity("sessions")
export class Session {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  classId!: string;

  @ManyToOne(() => Class, { onDelete: "CASCADE" })
  class!: Relation<Class>;

  @Column({ type: "timestamptz" })
  @Index()
  startAt!: Date;

  @Column({ type: "timestamptz" })
  endAt!: Date;

  @Column({ type: "varchar", length: 80, nullable: true })
  room!: string | null;

  @Column({ type: "int", default: 25 })
  gracePeriodMinutes!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
