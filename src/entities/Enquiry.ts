import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import {
  EnquiryExamOutcome,
  EnquiryNurtureState,
} from "../common/constants/enquiry.js";
import { EnquiryCompetitor } from "./EnquiryCompetitor.js";
import { EnquiryEvent } from "./EnquiryEvent.js";
import { EnquiryLossReason } from "./EnquiryLossReason.js";
import { EnquirySource } from "./EnquirySource.js";
import { EnquiryStage } from "./EnquiryStage.js";
import { EnquiryStageHistory } from "./EnquiryStageHistory.js";
import { User } from "./User.js";

@Entity("enquiries")
export class Enquiry {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120, nullable: true })
  studentFullName!: string | null;

  @Column({ type: "int", nullable: true })
  yearLevel!: number | null;

  @Column({ type: "varchar", length: 160, nullable: true })
  school!: string | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  subjectOfInterest!: string | null;

  @Column({ type: "varchar", length: 120 })
  guardianFullName!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  guardianEmail!: string | null;

  @Column({ type: "varchar", length: 30, nullable: true })
  guardianMobile!: string | null;

  @Column({ name: "first_source_id", type: "uuid" })
  @Index()
  firstSourceId!: string;

  @ManyToOne(() => EnquirySource, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "first_source_id" })
  firstSource!: Relation<EnquirySource>;

  @Column({ name: "last_source_id", type: "uuid" })
  @Index()
  lastSourceId!: string;

  @ManyToOne(() => EnquirySource, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "last_source_id" })
  lastSource!: Relation<EnquirySource>;

  @Column({ type: "uuid", nullable: true })
  @Index()
  ownerUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  owner!: Relation<User> | null;

  @Column({ type: "uuid" })
  @Index()
  currentStageId!: string;

  @ManyToOne(() => EnquiryStage, { onDelete: "RESTRICT" })
  currentStage!: Relation<EnquiryStage>;

  @Column({ type: "timestamptz" })
  lastStageChangedAt!: Date;

  @Column({ type: "int", nullable: true })
  score!: number | null;

  @Column({ type: "int", nullable: true })
  waitingListPosition!: number | null;

  @Column({
    type: "enum",
    enum: EnquiryNurtureState,
    default: EnquiryNurtureState.NONE,
  })
  nurtureState!: EnquiryNurtureState;

  @Column({ type: "varchar", length: 160, nullable: true })
  trialClassName!: string | null;

  @Column({ type: "date", nullable: true })
  trialEndDate!: string | null;

  @Column({ type: "boolean", default: false })
  trialConfirmed!: boolean;

  @Column({ type: "boolean", default: false })
  trialAttended!: boolean;

  @Column({ type: "varchar", length: 120, nullable: true })
  examSession!: string | null;

  @Column({ type: "numeric", precision: 6, scale: 2, nullable: true })
  examMark!: string | null;

  @Column({ type: "numeric", precision: 6, scale: 2, nullable: true })
  examThreshold!: string | null;

  @Column({ type: "enum", enum: EnquiryExamOutcome, nullable: true })
  examOutcome!: EnquiryExamOutcome | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  examMarkedBy!: string | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  examScriptReference!: string | null;

  @Column({ type: "uuid", nullable: true })
  lostReasonId!: string | null;

  @ManyToOne(() => EnquiryLossReason, { onDelete: "SET NULL", nullable: true })
  lostReason!: Relation<EnquiryLossReason> | null;

  @Column({ type: "uuid", nullable: true })
  competitorId!: string | null;

  @ManyToOne(() => EnquiryCompetitor, { onDelete: "SET NULL", nullable: true })
  competitor!: Relation<EnquiryCompetitor> | null;

  @Column({ type: "boolean", default: false })
  flagForReengagement!: boolean;

  @Column({ type: "uuid", nullable: true })
  linkedFromEnquiryId!: string | null;

  @ManyToOne(() => Enquiry, { onDelete: "SET NULL", nullable: true })
  linkedFromEnquiry!: Relation<Enquiry> | null;

  @Column({ type: "uuid", nullable: true })
  convertedEnrollmentId!: string | null;

  @Column({ type: "timestamptz", nullable: true })
  closedAt!: Date | null;

  @OneToMany(() => EnquiryStageHistory, (row) => row.enquiry)
  stageHistory!: Relation<EnquiryStageHistory>[];

  @OneToMany(() => EnquiryEvent, (row) => row.enquiry)
  events!: Relation<EnquiryEvent>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
