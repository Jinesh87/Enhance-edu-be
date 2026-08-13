import "reflect-metadata";
import { DataSource } from "typeorm";
import {
  RefreshToken,
  User,
  Class,
  Session,
  ClassStudent,
  AttendanceRecord,
  ScanEvent,
} from "../entities/index.js";
import { MessagingConfig } from "../entities/EmailConfig.js";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? "edu",
  password: process.env.DB_PASSWORD ?? "edu",
  database: process.env.DB_NAME ?? "edu",
  synchronize:
    process.env.DB_SYNC === "true" || process.env.NODE_ENV !== "production",
  logging: false,
  entities: [
    User,
    RefreshToken,
    MessagingConfig,
    Class,
    Session,
    ClassStudent,
    AttendanceRecord,
    ScanEvent,
  ],

  migrations: [],
  subscribers: [],
});
