import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../plugins/authMiddleware";
import { FastInstance } from "../utils/fastify";
import { ensureAdmin } from "../utils/auth";

const BannerTypeEnum = z.enum(["popup", "banner"]);

const BannerSchema = z.object({
  title: z.string().trim().min(1, "Title wajib diisi").max(255),
  imageUrl: z.string().trim().min(1, "Image URL wajib diisi").max(500),
  type: BannerTypeEnum,
  clickUrl: z.string().trim().max(500).optional().or(z.literal("")),
});

function forbidNonAdmin(req: any, reply: FastifyReply) {
  if (!ensureAdmin(req.user)) {
    reply.status(403).send({ message: "Forbidden" });
    return true;
  }
  return false;
}

function normalizeClickUrl(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export default async function (fastify: FastInstance) {
  fastify.get("/banners", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { type } = (req.query ?? {}) as { type?: "popup" | "banner" };

      const items = await fastify.prisma.banners.findMany({
        where: type ? { type } : undefined,
        orderBy: [{ id: "desc" }],
      });

      return reply.send(items);
    },
  });

  fastify.get("/banners/:id", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const banner = await fastify.prisma.banners.findUnique({
        where: { id: Number(id) },
      });

      if (!banner) {
        return reply.status(404).send({ message: "Banner tidak ditemukan." });
      }

      return reply.send(banner);
    },
  });

  fastify.post("/banners", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const parsed = BannerSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      const banner = await fastify.prisma.banners.create({
        data: {
          title: parsed.data.title,
          imageUrl: parsed.data.imageUrl,
          type: parsed.data.type,
          clickUrl: normalizeClickUrl(parsed.data.clickUrl),
        },
      });

      return reply.status(201).send({
        message: "Banner berhasil dibuat.",
        banner,
      });
    },
  });

  fastify.put("/banners/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const bannerId = Number(id);

      if (!Number.isFinite(bannerId)) {
        return reply.status(400).send({ message: "ID banner tidak valid." });
      }

      const exists = await fastify.prisma.banners.findUnique({
        where: { id: bannerId },
      });

      if (!exists) {
        return reply.status(404).send({ message: "Banner tidak ditemukan." });
      }

      const parsed = BannerSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      const banner = await fastify.prisma.banners.update({
        where: { id: bannerId },
        data: {
          title: parsed.data.title,
          imageUrl: parsed.data.imageUrl,
          type: parsed.data.type,
          clickUrl: normalizeClickUrl(parsed.data.clickUrl),
        },
      });

      return reply.send({
        message: "Banner berhasil diperbarui.",
        banner,
      });
    },
  });

  fastify.delete("/banners/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const bannerId = Number(id);

      if (!Number.isFinite(bannerId)) {
        return reply.status(400).send({ message: "ID banner tidak valid." });
      }

      const exists = await fastify.prisma.banners.findUnique({
        where: { id: bannerId },
      });

      if (!exists) {
        return reply.status(404).send({ message: "Banner tidak ditemukan." });
      }

      await fastify.prisma.banners.delete({
        where: { id: bannerId },
      });

      return reply.send({
        message: "Banner berhasil dihapus.",
      });
    },
  });
}
