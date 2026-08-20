import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { EnquiryStageKind } from "../common/constants/enquiry.js";

@Entity("enquiry_stages")
export class EnquiryStage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 40 })
  code!: string;

  @Column({ type: "varchar", length: 80 })
  name!: string;

  @Column({ type: "int" })
  sortOrder!: number;

  @Column({ type: "enum", enum: EnquiryStageKind })
  kind!: EnquiryStageKind;

  @Column({ type: "timestamptz", nullable: true })
  retiredAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
