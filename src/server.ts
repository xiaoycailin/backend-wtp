import Fastify, {
  type FastifyInstance,
  type FastifyPluginAsync,
} from "fastify";
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
import leaderboardRoute from "./routes/leaderboard.route";
import bannerRoute from "./routes/banner.route";
import cachePlugin from "./plugins/cache";
import promotionRoute from "./routes/promotion.route";
import inputTypesRoute from "./routes/input-types.route";

const apiRoutesPlugin: FastifyPluginAsync = async (
  instance: FastifyInstance,
) => {
  await instance.register(userRoutes);
  await instance.register(categoryRoute);
  await instance.register(productRoutes);
  await instance.register(uploadImageRoute);
  await instance.register(paymentRoute);
  await instance.register(transactionRoute);
  await instance.register(callbackRoute);
  await instance.register(gameCheckRoute);
  await instance.register(siteconfigRoute);
  await instance.register(activityRoute);
  await instance.register(systemLogRoute);
  await instance.register(badgeRoute);
  await instance.register(leaderboardRoute);
  await instance.register(bannerRoute);
  await instance.register(promotionRoute);
  await instance.register(inputTypesRoute);
  await instance.register(githubWebhookRoute);
};

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

  response(app);

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024,
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
      service: "backendwtp-update",
      version: "2",
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

  await app.register(apiRoutesPlugin); // tanpa prefix
  await app.register(apiRoutesPlugin, { prefix: "/api/v1" }); // dengan /api/v1

  return app;
};

export default buildServer;
