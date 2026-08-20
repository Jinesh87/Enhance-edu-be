import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from "typeorm";
import { Enquiry } from "./Enquiry.js";
import { EnquiryCompetitor } from "./EnquiryCompetitor.js";
import { EnquiryLossReason } from "./EnquiryLossReason.js";
import { EnquiryStage } from "./EnquiryStage.js";
import { User } from "./User.js";

@Entity("enquiry_stage_history")
export class EnquiryStageHistory {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  enquiryId!: string;

  @ManyToOne(() => Enquiry, (enquiry) => enquiry.stageHistory, {
    onDelete: "CASCADE",
  })
  enquiry!: Relation<Enquiry>;

  @Column({ type: "uuid", nullable: true })
  fromStageId!: string | null;

  @ManyToOne(() => EnquiryStage, { onDelete: "RESTRICT", nullable: true })
  fromStage!: Relation<EnquiryStage> | null;

  @Column({ type: "uuid" })
  toStageId!: string;

  @ManyToOne(() => EnquiryStage, { onDelete: "RESTRICT" })
  toStage!: Relation<EnquiryStage>;

  @Column({ type: "uuid", nullable: true })
  actorUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  actor!: Relation<User> | null;

  @Column({ type: "uuid", nullable: true })
  lostReasonId!: string | null;

  @ManyToOne(() => EnquiryLossReason, { onDelete: "SET NULL", nullable: true })
  lostReason!: Relation<EnquiryLossReason> | null;

  @Column({ type: "uuid", nullable: true })
  competitorId!: string | null;

  @ManyToOne(() => EnquiryCompetitor, { onDelete: "SET NULL", nullable: true })
  competitor!: Relation<EnquiryCompetitor> | null;

  @Column({ type: "text", nullable: true })
  note!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
