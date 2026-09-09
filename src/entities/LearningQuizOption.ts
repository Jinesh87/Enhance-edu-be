import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { LearningQuizQuestion } from "./LearningQuizQuestion.js";

@Entity("learning_quiz_options")
export class LearningQuizOption {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  questionId!: string;

  @ManyToOne(() => LearningQuizQuestion, (q) => q.options, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "questionId" })
  question!: Relation<LearningQuizQuestion>;

  @Column({ type: "text" })
  text!: string;

  @Column({ type: "boolean", default: false })
  isCorrect!: boolean;

  @Column({ type: "int", default: 0 })
  position!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
