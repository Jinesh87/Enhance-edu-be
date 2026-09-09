import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import type { FlashcardProgressStatus } from "../common/constants/learning.js";
import { LearningFlashcard } from "./LearningFlashcard.js";
import { User } from "./User.js";

@Entity("learning_flashcard_progress")
@Unique(["studentId", "flashcardId"])
export class LearningFlashcardProgress {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentId" })
  student!: Relation<User>;

  @Column({ type: "uuid" })
  @Index()
  flashcardId!: string;

  @ManyToOne(() => LearningFlashcard, { onDelete: "CASCADE" })
  @JoinColumn({ name: "flashcardId" })
  flashcard!: Relation<LearningFlashcard>;

  @Column({ type: "varchar", length: 20 })
  status!: FlashcardProgressStatus;

  @Column({ type: "timestamptz", nullable: true })
  lastReviewedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
