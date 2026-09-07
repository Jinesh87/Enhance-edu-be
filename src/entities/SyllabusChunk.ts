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
import { Subject } from "./Subject.js";
import { Syllabus } from "./Syllabus.js";
import { SyllabusDocument } from "./SyllabusDocument.js";

export type SyllabusChunkSourceType =
  | "document"
  | "overview"
  | "skill"
  | "title";

@Entity("syllabus_chunks")
@Index(["syllabusId", "sourceType", "chunkIndex"])
export class SyllabusChunk {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  syllabusId!: string;

  @ManyToOne(() => Syllabus, { onDelete: "CASCADE" })
  @JoinColumn({ name: "syllabusId" })
  syllabus!: Relation<Syllabus>;

  @Column({ type: "uuid" })
  @Index()
  subjectId!: string;

  @ManyToOne(() => Subject, { onDelete: "CASCADE" })
  @JoinColumn({ name: "subjectId" })
  subject!: Relation<Subject>;

  @Column({ type: "uuid", nullable: true })
  @Index()
  documentId!: string | null;

  @ManyToOne(() => SyllabusDocument, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "documentId" })
  document!: Relation<SyllabusDocument> | null;

  @Column({ type: "varchar", length: 40 })
  sourceType!: SyllabusChunkSourceType;

  @Column({ type: "varchar", length: 120, nullable: true })
  sourceLabel!: string | null;

  @Column({ type: "integer" })
  chunkIndex!: number;

  @Column({ type: "text" })
  content!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
