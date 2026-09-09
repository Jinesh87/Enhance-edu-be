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
import { LearningQuizOption } from "./LearningQuizOption.js";
import { LearningSet } from "./LearningSet.js";

@Entity("learning_quiz_questions")
export class LearningQuizQuestion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  learningSetId!: string;

  @ManyToOne(() => LearningSet, (set) => set.quizQuestions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "learningSetId" })
  learningSet!: Relation<LearningSet>;

  @Column({ type: "text" })
  question!: string;

  @Column({ type: "text", nullable: true })
  explanation!: string | null;

  @Column({ type: "int", default: 0 })
  position!: number;

  @OneToMany(() => LearningQuizOption, (row) => row.question)
  options!: Relation<LearningQuizOption>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
