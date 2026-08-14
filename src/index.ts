import "reflect-metadata";
import { env } from "./config/env.js";
import app from "./app.js";
import { AppDataSource } from "./config/data-source.js";
import { logger } from "./config/logger.js";
import { connectRedis } from "./config/redis.js";
import { seedSuperAdmin } from "./seeder/seed-super-admin.js";
import { adminTasksService } from "./modules/admin/tasks/admin-tasks.service.js";

const port = env.PORT;
const ABSENCE_CHASE_SYNC_MS = 60_000;

async function bootstrap() {
  await AppDataSource.initialize();
  logger.info("Database connected");

  await connectRedis();
  await seedSuperAdmin();

  app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "API listening");
  });

  const syncAbsenceChases = () => {
    void adminTasksService.syncAbsenceChaseTasks().catch((error) => {
      logger.warn({ err: error }, "Absence chase sync failed");
    });
  };

  syncAbsenceChases();
  const syncTimer = setInterval(syncAbsenceChases, ABSENCE_CHASE_SYNC_MS);
  syncTimer.unref();
}

bootstrap().catch((error) => {
  logger.fatal({ err: error }, "Failed to start server");
  process.exit(1);
});
