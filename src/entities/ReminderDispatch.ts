import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

/**
 * Idempotency ledger for scheduled class reminders / digests.
 * Unique dispatchKey prevents double-send across workers and retries.
 */
@Entity("reminder_dispatches")
export class ReminderDispatch {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** e.g. `1h:<sessionId>` or `digest:<userId>:<YYYY-MM-DD>` or `digest-scan:<YYYY-MM-DD>` */
  @Column({ type: "varchar", length: 160 })
  @Index({ unique: true })
  dispatchKey!: string;

  @Column({ type: "varchar", length: 40 })
  kind!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
