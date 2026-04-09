import { FastInstance } from "../utils/fastify";
import { authMiddleware } from "../plugins/authMiddleware";
import { ensureAdmin } from "../utils/auth";
import { serializeData } from "../utils/json";

export default async function (fastify: FastInstance) {
  fastify.get("/activity-logs", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user)) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      const {
        page = "1",
        limit = "20",
        action,
        entityType,
        search,
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const skip = (pageNum - 1) * limitNum;
      const q = search?.trim();

      const where: any = {
        ...(action ? { action } : {}),
        ...(entityType ? { entityType } : {}),
        ...(q
          ? {
              OR: [
                { actorName: { contains: q } },
                { entityLabel: { contains: q } },
                { description: { contains: q } },
              ],
            }
          : {}),
      };

      const [total, items] = await Promise.all([
        fastify.prisma.activityLog.count({ where }),
        fastify.prisma.activityLog.findMany({
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
