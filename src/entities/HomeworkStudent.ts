import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { Homework } from "./Homework.js";
import { User } from "./User.js";

@Entity("homework_students")
@Unique(["homeworkId", "studentId"])
export class HomeworkStudent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  homeworkId!: string;

  @ManyToOne(() => Homework, (homework) => homework.students, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "homeworkId" })
  homework!: Relation<Homework>;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentId" })
  student!: Relation<User>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
