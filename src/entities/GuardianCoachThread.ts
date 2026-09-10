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
import { GuardianCoachMessage } from "./GuardianCoachMessage.js";
import { User } from "./User.js";

@Entity("guardian_coach_threads")
@Index(["ownerUserId", "updatedAt"])
export class GuardianCoachThread {
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

  @Column({ type: "uuid", nullable: true })
  focusedStudentId!: string | null;

  @Column({ type: "varchar", length: 160, nullable: true })
  focusedStudentName!: string | null;

  @OneToMany(() => GuardianCoachMessage, (message) => message.thread)
  messages!: Relation<GuardianCoachMessage[]>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
