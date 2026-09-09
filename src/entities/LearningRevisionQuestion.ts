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
import { LearningSet } from "./LearningSet.js";

@Entity("learning_revision_questions")
export class LearningRevisionQuestion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  learningSetId!: string;

  @ManyToOne(() => LearningSet, (set) => set.revisionQuestions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "learningSetId" })
  learningSet!: Relation<LearningSet>;

  @Column({ type: "text" })
  question!: string;

  @Column({ type: "text" })
  answer!: string;

  @Column({ type: "int", default: 0 })
  position!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
