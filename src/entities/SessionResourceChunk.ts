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
import { Class } from "./Class.js";
import { Session } from "./Session.js";
import { SessionResource } from "./SessionResource.js";

export type SessionResourceChunkSourceType = "document" | "lesson";

@Entity("session_resource_chunks")
@Index(["sessionId", "sourceType", "chunkIndex"])
@Index(["classId", "chunkIndex"])
export class SessionResourceChunk {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: "CASCADE" })
  @JoinColumn({ name: "sessionId" })
  session!: Relation<Session>;

  @Column({ type: "uuid" })
  @Index()
  classId!: string;

  @ManyToOne(() => Class, { onDelete: "CASCADE" })
  @JoinColumn({ name: "classId" })
  class!: Relation<Class>;

  @Column({ type: "uuid", nullable: true })
  @Index()
  resourceId!: string | null;

  @ManyToOne(() => SessionResource, {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "resourceId" })
  resource!: Relation<SessionResource> | null;

  @Column({ type: "varchar", length: 40 })
  sourceType!: SessionResourceChunkSourceType;

  @Column({ type: "varchar", length: 255, nullable: true })
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
