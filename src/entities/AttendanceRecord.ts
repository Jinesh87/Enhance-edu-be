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
  Relation,
} from "typeorm";
import { Session } from "./Session.js";
import { User } from "./User.js";

export enum AttendanceStatus {
  PRESENT = "PRESENT",
  LATE = "LATE",
  ABSENT = "ABSENT",
  EXCUSED = "EXCUSED",
  EXCEPTION = "EXCEPTION",
  PENDING = "PENDING",
}

@Entity("attendance_records")
@Unique(["sessionId", "studentId"])
export class AttendanceRecord {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: "CASCADE" })
  session!: Relation<Session>;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  student!: Relation<User>;

  @Column({
    type: "varchar",
    length: 50,
    default: "PENDING",
  })
  @Index()
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
  markedByUser!: Relation<User> | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  absencePolicy!: string | null;

  @Column({ type: "uuid", nullable: true })
  @Index()
  followUpStaffId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "followUpStaffId" })
  followUpStaff!: Relation<User> | null;

  @Column({ type: "varchar", length: 32, nullable: true })
  parentAlertStatus!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  parentAlertSentAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
