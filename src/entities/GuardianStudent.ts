import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { Student } from "./Student.js";
import { User } from "./User.js";

@Entity("guardian_students")
@Unique(["guardianId", "studentId"])
export class GuardianStudent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  guardianId!: string;

  @ManyToOne(() => User, (user) => user.studentLinks, { onDelete: "CASCADE" })
  guardian!: Relation<User>;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => Student, (student) => student.guardianLinks, {
    onDelete: "CASCADE",
  })
  student!: Relation<Student>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
