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
} from "typeorm";
import { LearningQuizAttempt } from "./LearningQuizAttempt.js";
import { LearningQuizOption } from "./LearningQuizOption.js";
import { LearningQuizQuestion } from "./LearningQuizQuestion.js";

@Entity("learning_quiz_answers")
@Unique(["attemptId", "questionId"])
export class LearningQuizAnswer {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  attemptId!: string;

  @ManyToOne(() => LearningQuizAttempt, (a) => a.answers, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "attemptId" })
  attempt!: Relation<LearningQuizAttempt>;

  @Column({ type: "uuid" })
  @Index()
  questionId!: string;

  @ManyToOne(() => LearningQuizQuestion, { onDelete: "CASCADE" })
  @JoinColumn({ name: "questionId" })
  question!: Relation<LearningQuizQuestion>;

  @Column({ type: "uuid", nullable: true })
  selectedOptionId!: string | null;

  @ManyToOne(() => LearningQuizOption, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "selectedOptionId" })
  selectedOption!: Relation<LearningQuizOption> | null;

  @Column({ type: "boolean", default: false })
  isCorrect!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
