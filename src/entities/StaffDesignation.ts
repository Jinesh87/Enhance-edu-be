import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

/** Reusable job title for office staff; users store the chosen name as text. */
@Entity("staff_designations")
export class StaffDesignation {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120, unique: true })
  name!: string;

  @Column({ type: "uuid", nullable: true })
  createdById!: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
