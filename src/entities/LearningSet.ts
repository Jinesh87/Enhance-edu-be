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
import type {
  LearningDifficulty,
  LearningGenerationType,
  LearningSetStatus,
} from "../common/constants/learning.js";
import { LearningFlashcard } from "./LearningFlashcard.js";
import { LearningQuizQuestion } from "./LearningQuizQuestion.js";
import { LearningRevisionQuestion } from "./LearningRevisionQuestion.js";
import { LearningSourceDocument } from "./LearningSourceDocument.js";
import { Subject } from "./Subject.js";
import { Term } from "./Term.js";
import { User } from "./User.js";

@Entity("learning_sets")
export class LearningSet {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 160 })
  title!: string;

  @Column({ type: "uuid" })
  @Index()
  subjectId!: string;

  @ManyToOne(() => Subject, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "subjectId" })
  subject!: Relation<Subject>;

  @Column({ type: "uuid" })
  @Index()
  termId!: string;

  @ManyToOne(() => Term, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "termId" })
  term!: Relation<Term>;

  @Column({ type: "varchar", length: 80 })
  yearGroup!: string;

  @Column({ type: "uuid" })
  @Index()
  teacherId!: string;

  @ManyToOne(() => User, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "teacherId" })
  teacher!: Relation<User>;

  @Column({ type: "uuid", nullable: true })
  @Index()
  sourceDocumentId!: string | null;

  @ManyToOne(() => LearningSourceDocument, {
    onDelete: "SET NULL",
    nullable: true,
  })
  @JoinColumn({ name: "sourceDocumentId" })
  sourceDocument!: Relation<LearningSourceDocument> | null;

  @Column({ type: "varchar", length: 20 })
  @Index()
  generationType!: LearningGenerationType;

  @Column({ type: "varchar", length: 20, default: "medium" })
  difficulty!: LearningDifficulty;

  @Column({ type: "int", default: 8 })
  itemCount!: number;

  /** Marks awarded per correct quiz question. */
  @Column({ type: "numeric", precision: 6, scale: 2, default: 1 })
  marksPerQuestion!: string;

  /** Quiz deadline (null for flashcards/revision, or unset quiz). */
  @Column({ type: "timestamptz", nullable: true })
  dueAt!: Date | null;

  @Column({ type: "varchar", length: 20, default: "DRAFT" })
  @Index()
  status!: LearningSetStatus;

  @Column({ type: "timestamptz", nullable: true })
  publishedAt!: Date | null;

  @OneToMany(() => LearningFlashcard, (row) => row.learningSet)
  flashcards!: Relation<LearningFlashcard>[];

  @OneToMany(() => LearningQuizQuestion, (row) => row.learningSet)
  quizQuestions!: Relation<LearningQuizQuestion>[];

  @OneToMany(() => LearningRevisionQuestion, (row) => row.learningSet)
  revisionQuestions!: Relation<LearningRevisionQuestion>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
