import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User.js";

/** A user's own Google account, linked so meetings can be booked on their calendar. Tokens are encrypted. */
@Entity("google_calendar_connections")
export class GoogleCalendarConnection {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid", unique: true })
  userId!: string;

  @OneToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: Relation<User>;

  @Column({ type: "varchar", length: 320, nullable: true })
  googleEmail!: string | null;

  @Column({ type: "varchar", length: 320, default: "primary" })
  calendarId!: string;

  @Column({ type: "text" })
  refreshTokenEnc!: string;

  @Column({ type: "text", nullable: true })
  accessTokenEnc!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  accessTokenExpiresAt!: Date | null;

  @Column({ type: "text", nullable: true })
  scopes!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  connectedAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
