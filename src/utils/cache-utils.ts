import type { FastifyRequest, FastifyReply, FastifyInstance, HookHandlerDoneFunction } from "fastify";

/**
 * Generate cache key from request
 */
export function generateCacheKey(req: FastifyRequest): string {
  const { url, method } = req;
  const query = Object.keys(req.query as any)
    .sort()
    .map((k) => `${k}=${(req.query as any)[k]}`)
    .join("&");
  const key = `${method}:${url}${query ? "?" + query : ""}`;
  // replace characters that may cause issues
  return key.replace(/[^a-zA-Z0-9:_\-?=&]/g, "_");
}

/**
 * Cache middleware for GET endpoints
 * Usage: wrap handler with cacheMiddleware(fastify, ttlSeconds)
 */
export function cacheMiddleware(
  fastify: FastifyInstance,
  ttlSeconds: number = 300
) {
  return (req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    // Only cache GET requests
    if (req.method !== "GET") {
      done();
      return;
    }

    const key = generateCacheKey(req);
    const cached = fastify.cache.get(key);
    if (cached !== undefined) {
      fastify.log.debug({ key }, "Cache hit");
      reply.send(cached);
      return;
    }

    // Capture original send method
    const originalSend = reply.send;
    let responseSent = false;

    reply.send = function (data: any) {
      if (!responseSent) {
        fastify.cache.set(key, data, ttlSeconds);
        fastify.log.debug({ key, ttlSeconds }, "Cache set");
        responseSent = true;
      }
      return originalSend.call(this, data);
    };

    done();
  };
}

/**
 * Invalidate cache for a specific pattern
 */
export function invalidateCache(fastify: FastifyInstance, pattern: string) {
  const keys = fastify.cache.keys();
  const matched = keys.filter((k) => k.includes(pattern));
  matched.forEach((k) => fastify.cache.del(k));
  fastify.log.info({ pattern, invalidated: matched.length }, "Cache invalidated");
}