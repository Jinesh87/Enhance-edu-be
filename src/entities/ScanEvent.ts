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

export enum ScanStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  IGNORED = "IGNORED",
}

export enum ScanFlagReason {
  NONE = "NONE",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  DUPLICATE_SCAN = "DUPLICATE_SCAN",
  OFF_NETWORK = "OFF_NETWORK",
  WRONG_SESSION_CODE = "WRONG_SESSION_CODE",
}

@Entity("scan_events")
export class ScanEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  student!: User;

  @Column({ type: "uuid" })
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
  status!: ScanStatus;

  @Column({
    type: "enum",
    enum: ScanFlagReason,
    default: ScanFlagReason.NONE,
  })
  reasonFlagged!: ScanFlagReason;

  @Column({ type: "varchar", length: 50, nullable: true })
  adminDecision!: string | null;

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
