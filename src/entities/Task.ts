import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { UserRole } from "../common/constants/roles.js";
import { AttendanceRecord } from "./AttendanceRecord.js";
import { Session } from "./Session.js";
import { User } from "./User.js";

export enum TaskType {
  ABSENCE_CHASE = "ABSENCE_CHASE",
}

export enum TaskStatus {
  OPEN = "OPEN",
  DONE = "DONE",
}

@Entity("tasks")
@Unique(["type", "sessionId", "studentId"])
export class Task {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "enum", enum: TaskType })
  @Index()
  type!: TaskType;

  @Column({ type: "enum", enum: TaskStatus, default: TaskStatus.OPEN })
  @Index()
  status!: TaskStatus;

  @Column({ type: "enum", enum: UserRole, default: UserRole.SUPER_ADMIN })
  @Index()
  assignedRole!: UserRole;

  @Column({ type: "varchar", length: 200 })
  title!: string;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentId" })
  student!: User;

  @Column({ type: "uuid" })
  @Index()
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: "CASCADE" })
  @JoinColumn({ name: "sessionId" })
  session!: Session;

  @Column({ type: "uuid", nullable: true })
  attendanceRecordId!: string | null;

  @ManyToOne(() => AttendanceRecord, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "attendanceRecordId" })
  attendanceRecord!: AttendanceRecord | null;

  @Column({ type: "timestamptz" })
  dueAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  completedAt!: Date | null;

  @Column({ type: "uuid", nullable: true })
  completedByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "completedByUserId" })
  completedByUser!: User | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
