import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("enquiry_sources")
export class EnquirySource {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 80 })
  name!: string;

  @Column({ type: "int", default: 0 })
  sortOrder!: number;

  @Column({ type: "timestamptz", nullable: true })
  retiredAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
