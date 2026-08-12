import "reflect-metadata";
import "dotenv/config";
import app from "./app.js";
import { AppDataSource } from "./config/data-source.js";
import { logger } from "./config/logger.js";
import { connectRedis } from "./config/redis.js";
import { seedSuperAdmin } from "./seeder/seed-super-admin.js";

const port = Number(process.env.PORT ?? 3000);

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
