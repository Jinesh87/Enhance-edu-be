import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from "typeorm";
import { EnquiryStage } from "./EnquiryStage.js";

@Entity("enquiry_loss_reasons")
export class EnquiryLossReason {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  stageId!: string;

  @ManyToOne(() => EnquiryStage, { onDelete: "RESTRICT" })
  stage!: Relation<EnquiryStage>;

  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "boolean", default: false })
  requiresCompetitor!: boolean;

  @Column({ type: "timestamptz", nullable: true })
  retiredAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
