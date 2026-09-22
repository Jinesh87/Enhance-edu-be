import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Relation,
  UpdateDateColumn,
} from "typeorm";
import { User } from "./User.js";

/**
 * Client-generated ECDH P-256 public key (SPKI, base64).
 * Private key never leaves the device (IndexedDB).
 */
@Entity("chat_user_public_keys")
export class ChatUserPublicKey {
  @PrimaryColumn({ type: "uuid" })
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: Relation<User>;

  /** SPKI-encoded P-256 public key, base64. */
  @Column({ type: "text" })
  publicKey!: string;

  @Column({ type: "varchar", length: 16, default: "P-256" })
  algorithm!: string;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  @Index()
  updatedAt!: Date;
}
