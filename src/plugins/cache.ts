import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin"; // ← tambahkan ini
import Redis from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
    cache: {
      get: <T>(key: string) => Promise<T | null>;
      set: (key: string, value: unknown, ttl?: number) => Promise<void>;
      del: (key: string | string[]) => Promise<void>;
      flush: () => Promise<void>;
    };
  }
}

const cachePlugin: FastifyPluginAsync = async (fastify) => {
  const redis = new Redis({
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    connectTimeout: 10000,
    retryStrategy: (times) => Math.min(times * 500, 2000),
  });

  redis.on("connect", () => fastify.log.info("Redis connected ✅"));
  redis.on("error", (err) => fastify.log.error({ err }, "Redis error ❌"));

  fastify.decorate("redis", redis);

  const DEFAULT_TTL = 300;

  fastify.decorate("cache", {
    async get<T>(key: string): Promise<T | null> {
      const data = await redis.get(key);
      if (!data) return null;
      try {
        return JSON.parse(data) as T;
      } catch {
        return data as unknown as T;
      }
    },
    async set(key: string, value: unknown, ttl = DEFAULT_TTL): Promise<void> {
      await redis.setex(key, ttl, JSON.stringify(value));
    },
    async del(key: string | string[]): Promise<void> {
      if (Array.isArray(key)) {
        if (key.length > 0) await redis.del(...key);
      } else {
        await redis.del(key);
      }
    },
    async flush(): Promise<void> {
      await redis.flushdb();
    },
  });

  fastify.addHook("onClose", async () => {
    await redis.quit();
    fastify.log.info("Redis disconnected");
  });
};

// fp() membuat decorator tersedia di semua scope (skip encapsulation)
export default fp(cachePlugin, {
  name: "cache",
});
