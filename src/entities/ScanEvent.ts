import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Session } from "./Session.js";
import { User } from "./User.js";

export enum ScanStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  IGNORED = "IGNORED",
}

export enum AdminDecision {
  ACCEPT = "Accept",
  ACCEPT_AS_LATE = "Accept as late",
  REJECT = "Reject",
  IGNORE = "Ignore",
}

export enum ScanFlagReason {
  NONE = "NONE",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  DUPLICATE_SCAN = "DUPLICATE_SCAN",
  OFF_NETWORK = "OFF_NETWORK",
  WRONG_SESSION_CODE = "WRONG_SESSION_CODE",
  SUSPICIOUS_OFFLINE_TIMESTAMP = "SUSPICIOUS_OFFLINE_TIMESTAMP",
}

@Entity("scan_events")
export class ScanEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  student!: User;

  @Column({ type: "uuid" })
  @Index()
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: "CASCADE" })
  session!: Session;

  @Column({ type: "timestamptz" })
  scannedAt!: Date;

  @Column({ type: "timestamptz" })
  syncedAt!: Date;

  @Column({ type: "varchar", length: 255 })
  scannedCode!: string;

  @Column({ type: "varchar", length: 80, default: "wifi - same LAN" })
  deviceSignal!: string;

  @Column({ type: "boolean", default: false })
  isOfflineSync!: boolean;

  @Column({
    type: "enum",
    enum: ScanStatus,
    default: ScanStatus.PENDING,
  })
  @Index()
  status!: ScanStatus;

  @Column({
    type: "enum",
    enum: ScanFlagReason,
    default: ScanFlagReason.NONE,
  })
  reasonFlagged!: ScanFlagReason;

  @Column({
    type: "enum",
    enum: AdminDecision,
    nullable: true,
  })
  adminDecision!: AdminDecision | null;

  @Column({ type: "timestamptz", nullable: true })
  resolvedAt!: Date | null;

  @Column({ type: "uuid", nullable: true })
  resolvedByUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  resolvedByUser!: User | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
