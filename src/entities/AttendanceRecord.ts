import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Session } from "./Session.js";
import { User } from "./User.js";

export enum AttendanceStatus {
  PRESENT = "PRESENT",
  LATE = "LATE",
  ABSENT = "ABSENT",
  EXCUSED = "EXCUSED",
  EXCEPTION = "EXCEPTION",
}

@Entity("attendance_records")
export class AttendanceRecord {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: "CASCADE" })
  session!: Session;

  @Column({ type: "uuid" })
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  student!: User;

  @Column({
    type: "enum",
    enum: AttendanceStatus,
    default: AttendanceStatus.ABSENT,
  })
  status!: AttendanceStatus;

  @Column({ type: "timestamptz", nullable: true })
  scannedAt!: Date | null;

  @Column({ type: "boolean", default: false })
  markedManually!: boolean;

  @Column({ type: "varchar", length: 255, nullable: true })
  manualReason!: string | null;

  @Column({ type: "uuid", nullable: true })
  markedByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  markedByUser!: User | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
