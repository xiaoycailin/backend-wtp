import Fastify from "fastify";
import prismaPlugin from "./plugins/prisma";
import response from "./plugins/response";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { join } from "path";

import userRoutes from "./routes/user.route";
import productRoutes from "./routes/products.route";
import categoryRoute from "./routes/category.route";
import uploadImageRoute from "./routes/upload-image.route";
import paymentRoute from "./routes/payment.route";
import callbackRoute from "./routes/callback.route";
import transactionRoute from "./routes/transaction.route";
import gameCheckRoute from "./routes/game-check.route";
import siteconfigRoute from "./routes/siteconfig.route";
import githubWebhookRoute from "./routes/github-webhook.route";
import activityRoute from "./routes/activity.route";
import systemLogRoute from "./routes/system-log.route";
import badgeRoute from "./routes/badge.route";
import cachePlugin from "./plugins/cache";

const buildServer = async () => {
  const app = Fastify({
    logger: {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    },
  });

  // Response wrapper + error handler
  response(app);

  // Plugins
  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5 MB
    },
  });

  app.register(fastifyStatic, {
    root: join(process.cwd(), "static"),
    prefix: "/static/",
  });

  await app.register(prismaPlugin);
  await app.register(cachePlugin);

  app.get("/health", async () => {
    return {
      ok: true,
      service: "backend-by-fennai",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  app.get("/health/db", async (_req, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return {
        ok: true,
        database: "reachable",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      app.log.error({ error }, "Database health check failed");
      return reply.status(500).send({
        ok: false,
        database: "unreachable",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Routes
  await app.register(userRoutes);
  await app.register(categoryRoute);
  await app.register(productRoutes);
  await app.register(uploadImageRoute);
  await app.register(paymentRoute);
  await app.register(transactionRoute);
  await app.register(callbackRoute);
  await app.register(gameCheckRoute);
  await app.register(siteconfigRoute);
  await app.register(activityRoute);
  await app.register(systemLogRoute);
  await app.register(badgeRoute);
  await app.register(githubWebhookRoute);

  return app;
};

export default buildServer;
