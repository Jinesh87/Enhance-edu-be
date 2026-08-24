import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("institution_setting")
export class InstitutionSetting {
  @PrimaryColumn({ type: "varchar", length: 50 })
  id!: string;

  @Column({ type: "double precision", nullable: true })
  latitude!: number | null;

  @Column({ type: "double precision", nullable: true })
  longitude!: number | null;

  /** When true, users with 2FA configured must enter a code at login. */
  @Column({ type: "boolean", default: false })
  login2faEnabled!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
