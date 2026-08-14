import "reflect-metadata";
import { env } from "./config/env.js";
import app from "./app.js";
import { AppDataSource } from "./config/data-source.js";
import { logger } from "./config/logger.js";
import { connectRedis } from "./config/redis.js";
import { seedSuperAdmin } from "./seeder/seed-super-admin.js";

const port = env.PORT;

async function bootstrap() {
  await AppDataSource.initialize();
  logger.info("Database connected");

  await connectRedis();
  await seedSuperAdmin();

  app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "API listening");
  });
}

bootstrap().catch((error) => {
  logger.fatal({ err: error }, "Failed to start server");
  process.exit(1);
});
