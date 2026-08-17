import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { GuardianStudent } from "./GuardianStudent.js";
import { User } from "./User.js";

@Entity("students")
export class Student {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  fullName!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  preferredName!: string | null;

  @Column({ type: "date", nullable: true })
  dateOfBirth!: string | null;

  @Column({ type: "int", nullable: true })
  yearLevel!: number | null;

  @Column({ type: "uuid", nullable: true })
  @Index()
  userId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  user!: Relation<User> | null;

  @OneToMany(() => GuardianStudent, (link) => link.student)
  guardianLinks!: Relation<GuardianStudent>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
