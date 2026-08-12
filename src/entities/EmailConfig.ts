import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("messaging_config")
export class MessagingConfig {
  @PrimaryColumn({ type: "varchar", length: 50 })
  id!: string; // Will always be 'default' for singleton pattern

  @Column({ type: "varchar", length: 255 })
  resendApiKey!: string;

  @Column({ type: "varchar", length: 255 })
  fromEmail!: string;

  @Column({ type: "varchar", length: 255 })
  fromName!: string;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "varchar", length: 255, nullable: true })
  twilioAccountSid!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  twilioAuthToken!: string | null;

  @Column({ type: "varchar", length: 40, nullable: true })
  twilioFromNumber!: string | null;

  @Column({ type: "boolean", default: false })
  smsEnabled!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
