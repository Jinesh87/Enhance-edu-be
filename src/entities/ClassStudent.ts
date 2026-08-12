import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Class } from "./Class.js";
import { User } from "./User.js";

@Entity("class_students")
export class ClassStudent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  classId!: string;

  @ManyToOne(() => Class, { onDelete: "CASCADE" })
  class!: Class;

  @Column({ type: "uuid" })
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  student!: User;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
