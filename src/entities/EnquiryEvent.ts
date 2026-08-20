import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from "typeorm";
import { Enquiry } from "./Enquiry.js";
import { User } from "./User.js";

@Entity("enquiry_events")
export class EnquiryEvent {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  @Index()
  enquiryId!: string;

  @ManyToOne(() => Enquiry, (enquiry) => enquiry.events, {
    onDelete: "CASCADE",
  })
  enquiry!: Relation<Enquiry>;

  @Column({ type: "varchar", length: 40 })
  kind!: string;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "uuid", nullable: true })
  actorUserId!: string | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  actor!: Relation<User> | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
