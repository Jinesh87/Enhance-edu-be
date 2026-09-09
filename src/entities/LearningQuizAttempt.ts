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
import { LearningQuizAnswer } from "./LearningQuizAnswer.js";
import { LearningSet } from "./LearningSet.js";
import { User } from "./User.js";

@Entity("learning_quiz_attempts")
export class LearningQuizAttempt {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  learningSetId!: string;

  @ManyToOne(() => LearningSet, { onDelete: "CASCADE" })
  @JoinColumn({ name: "learningSetId" })
  learningSet!: Relation<LearningSet>;

  @Column({ type: "uuid" })
  @Index()
  studentId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "studentId" })
  student!: Relation<User>;

  @Column({ type: "numeric", precision: 8, scale: 2, default: 0 })
  score!: string;

  @Column({ type: "numeric", precision: 8, scale: 2, default: 0 })
  totalMarks!: string;

  @Column({ type: "int", default: 0 })
  correctCount!: number;

  @Column({ type: "int", default: 0 })
  totalQuestions!: number;

  @Column({ type: "numeric", precision: 5, scale: 2, nullable: true })
  percentage!: string | null;

  @Column({ type: "timestamptz" })
  startedAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  completedAt!: Date | null;

  /** Frozen review of questions/answers at submit time (survives later teacher edits). */
  @Column({ type: "jsonb", nullable: true })
  reviewSnapshot!: Array<{
    questionId: string;
    question: string;
    explanation: string | null;
    options: Array<{ id: string; text: string; isCorrect: boolean }>;
    selectedOptionId: string | null;
    correctOptionId: string | null;
    isCorrect: boolean;
  }> | null;

  @OneToMany(() => LearningQuizAnswer, (row) => row.attempt)
  answers!: Relation<LearningQuizAnswer>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
