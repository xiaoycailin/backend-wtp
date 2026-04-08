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

  app.register(prismaPlugin);

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
  app.register(userRoutes);
  app.register(categoryRoute);
  app.register(productRoutes);
  app.register(uploadImageRoute);
  app.register(paymentRoute);
  app.register(transactionRoute);
  app.register(callbackRoute);
  app.register(gameCheckRoute);
  app.register(siteconfigRoute);
  app.register(githubWebhookRoute);

  return app;
};

export default buildServer;
