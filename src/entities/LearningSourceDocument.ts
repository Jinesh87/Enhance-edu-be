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
import { User } from "./User.js";

@Entity("learning_source_documents")
export class LearningSourceDocument {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 512 })
  storageKey!: string;

  @Column({ type: "varchar", length: 255 })
  originalName!: string;

  @Column({ type: "varchar", length: 120 })
  mimeType!: string;

  @Column({ type: "int" })
  byteSize!: number;

  @Column({ type: "text", nullable: true })
  extractedText!: string | null;

  @Column({ type: "varchar", length: 40, nullable: true })
  extractionMethod!: string | null;

  @Column({ type: "uuid" })
  @Index()
  uploadedById!: string;

  @ManyToOne(() => User, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "uploadedById" })
  uploadedBy!: Relation<User>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
