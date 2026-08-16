import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("academic_years")
export class AcademicYear {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "integer", unique: true })
  year!: number;

  @Column({ type: "varchar", length: 60 })
  displayName!: string;

  @Column({ type: "boolean", default: false })
  isCurrent!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
