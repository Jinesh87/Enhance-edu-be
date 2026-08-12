import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("email_config")
export class EmailConfig {
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

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
