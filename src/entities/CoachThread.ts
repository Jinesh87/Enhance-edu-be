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
import { CoachMessage } from "./CoachMessage.js";
import { Student } from "./Student.js";

@Entity("coach_threads")
export class CoachThread {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => Student, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentId" })
  student!: Relation<Student>;

  @Column({ type: "varchar", length: 200, nullable: true })
  title!: string | null;

  @OneToMany(() => CoachMessage, (message) => message.thread)
  messages!: Relation<CoachMessage[]>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
