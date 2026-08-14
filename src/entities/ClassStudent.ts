import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { Class } from "./Class.js";
import { User } from "./User.js";

@Entity("class_students")
@Unique(["classId", "studentId"])
export class ClassStudent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  classId!: string;

  @ManyToOne(() => Class, { onDelete: "CASCADE" })
  class!: Class;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  student!: User;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
