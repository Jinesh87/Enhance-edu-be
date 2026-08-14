import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User.js";

@Entity("classes")
export class Class {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 30 })
  code!: string;

  @Column({ type: "varchar", length: 80, default: "Room 4" })
  room!: string;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @Index()
  teacher!: User | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
