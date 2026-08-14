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
import { env } from "./env.js";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  synchronize: env.DB_SYNC === "true" || env.NODE_ENV !== "production",
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
