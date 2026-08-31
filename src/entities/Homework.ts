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
import { HomeworkAttachment } from "./HomeworkAttachment.js";
import { HomeworkStudent } from "./HomeworkStudent.js";
import { HomeworkSubmission } from "./HomeworkSubmission.js";
import { Subject } from "./Subject.js";
import { Term } from "./Term.js";
import { User } from "./User.js";

@Entity("homework")
export class Homework {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 160 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "date" })
  @Index()
  dueDate!: string;

  @Column({ type: "numeric", precision: 5, scale: 2, nullable: true, default: 100 })
  maxMarks!: number | null;

  @Column({ type: "uuid" })
  @Index()
  termId!: string;

  @ManyToOne(() => Term, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "termId" })
  term!: Relation<Term>;

  @Column({ type: "uuid" })
  @Index()
  subjectId!: string;

  @ManyToOne(() => Subject, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "subjectId" })
  subject!: Relation<Subject>;

  @Column({ type: "varchar", length: 80 })
  yearGroup!: string;

  @Column({ type: "uuid" })
  @Index()
  createdById!: string;

  @ManyToOne(() => User, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "createdById" })
  createdBy!: Relation<User>;

  @OneToMany(() => HomeworkAttachment, (row) => row.homework)
  attachments!: Relation<HomeworkAttachment>[];

  @OneToMany(() => HomeworkStudent, (row) => row.homework)
  students!: Relation<HomeworkStudent>[];

  @OneToMany(() => HomeworkSubmission, (row) => row.homework)
  submissions!: Relation<HomeworkSubmission>[];

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
