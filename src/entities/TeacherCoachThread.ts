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
import { TeacherCoachMessage } from "./TeacherCoachMessage.js";
import { User } from "./User.js";

@Entity("teacher_coach_threads")
@Index(["ownerUserId", "updatedAt"])
export class TeacherCoachThread {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  ownerUserId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "ownerUserId" })
  owner!: Relation<User>;

  @Column({ type: "varchar", length: 200, nullable: true })
  title!: string | null;

  @OneToMany(() => TeacherCoachMessage, (message) => message.thread)
  messages!: Relation<TeacherCoachMessage[]>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
