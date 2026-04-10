import { authMiddleware } from "../plugins/authMiddleware";
import { FastInstance } from "../utils/fastify";

export default async function badgeRoute(fastify: FastInstance) {
  const ensureAdmin = (user: any, reply: any): boolean => {
    if (!user || user.role !== "admin") {
      reply.status(403).send({ message: "You do not have permission to perform this action." });
      return false;
    }
    return true;
  };

  fastify.get("/badges", async (_req, reply) => {
    const badges = await (fastify.prisma as any).badges.findMany({
      orderBy: { id: "desc" },
    });

    return reply.send(badges);
  });

  fastify.post("/badges", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user, reply)) return;

      const { label, color } = req.body as any;
      if (!label?.trim()) {
        return reply.status(400).send({ message: "Label wajib diisi." });
      }

      const badge = await (fastify.prisma as any).badges.create({
        data: {
          label: label.trim(),
          color: color?.trim() || "#f5c518",
        },
      });

      return reply.status(201).send({
        message: "Badge berhasil dibuat.",
        ...badge,
      });
    },
  });

  fastify.put("/badges/:id", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user, reply)) return;

      const { id } = req.params as any;
      const { label, color } = req.body as any;

      const existing = await (fastify.prisma as any).badges.findUnique({
        where: { id: Number(id) },
      });

      if (!existing) {
        return reply.status(404).send({ message: "Badge tidak ditemukan." });
      }

      const badge = await (fastify.prisma as any).badges.update({
        where: { id: Number(id) },
        data: {
          label: label?.trim() || existing.label,
          color: color?.trim() || existing.color,
        },
      });

      return reply.send({
        message: "Badge berhasil diupdate.",
        ...badge,
      });
    },
  });

  fastify.delete("/badges/:id", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user, reply)) return;

      const { id } = req.params as any;
      const badgeId = Number(id);

      const existing = await (fastify.prisma as any).badges.findUnique({
        where: { id: badgeId },
      });

      if (!existing) {
        return reply.status(404).send({ message: "Badge tidak ditemukan." });
      }

      await fastify.prisma.subCategory.updateMany({
        where: { badgeId },
        data: { badgeId: null },
      });

      await (fastify.prisma as any).badges.delete({
        where: { id: badgeId },
      });

      return reply.send({ message: "Badge berhasil dihapus." });
    },
  });
}
