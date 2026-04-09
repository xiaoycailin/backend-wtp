import { FastInstance } from "../utils/fastify";
import { authMiddleware } from "../plugins/authMiddleware";
import { ensureAdmin } from "../utils/auth";
import { serializeData } from "../utils/json";

export default async function (fastify: FastInstance) {
  fastify.get("/system-logs", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user)) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      const {
        page = "1",
        limit = "20",
        type,
        source,
        provider,
        trxId,
        search,
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const skip = (pageNum - 1) * limitNum;
      const q = search?.trim();

      const where: any = {
        ...(type ? { type } : {}),
        ...(source ? { source } : {}),
        ...(provider ? { provider } : {}),
        ...(trxId ? { trxId } : {}),
        ...(q
          ? {
              OR: [
                { message: { contains: q } },
                { source: { contains: q } },
                { trxId: { contains: q } },
                { url: { contains: q } },
              ],
            }
          : {}),
      };

      const [total, items] = await Promise.all([
        (fastify.prisma as any).systemLog.count({ where }),
        (fastify.prisma as any).systemLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limitNum,
        }),
      ]);

      return reply.send(
        serializeData({
          items,
          meta: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum) || 1,
          },
        }),
      );
    },
  });
}
