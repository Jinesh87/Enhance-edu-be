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

@Entity("learning_flashcards")
export class LearningFlashcard {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  learningSetId!: string;

  @ManyToOne(() => LearningSet, (set) => set.flashcards, { onDelete: "CASCADE" })
  @JoinColumn({ name: "learningSetId" })
  learningSet!: Relation<LearningSet>;

  @Column({ type: "text" })
  front!: string;

  @Column({ type: "text" })
  back!: string;

  @Column({ type: "int", default: 0 })
  position!: number;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
