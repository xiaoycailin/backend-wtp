import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import NodeCache from "node-cache";

declare module "fastify" {
  interface FastifyInstance {
    cache: NodeCache;
  }
}

const cachePlugin: FastifyPluginAsync = async (fastify, opts) => {
  const cache = new NodeCache({
    stdTTL: 300, // 5 minutes default
    checkperiod: 60,
    useClones: false,
  });

  fastify.decorate("cache", cache);

  fastify.addHook("onClose", (instance, done) => {
    cache.flushAll();
    cache.close();
    done();
  });

  fastify.log.info("Cache plugin registered");
};

export default cachePlugin;