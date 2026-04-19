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

// Helper invalidasi semua cache banner
async function invalidateBannerCache(fastify: FastInstance) {
  await fastify.cache.del([
    "banners:all",
    "banners:type:popup",
    "banners:type:banner",
  ]);
}

export default async function (fastify: FastInstance) {
  // GET /banners
  fastify.get("/banners", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { type } = (req.query ?? {}) as { type?: "popup" | "banner" };

      const cacheKey = type ? `banners:type:${type}` : "banners:all";

      // Cek cache
      const cached = await fastify.cache.get<any[]>(cacheKey);
      if (cached) return reply.send(cached);

      const items = await fastify.prisma.banners.findMany({
        where: type ? { type } : undefined,
        orderBy: [{ id: "desc" }],
      });

      // Simpan cache TTL 1 jam (banner jarang berubah)
      await fastify.cache.set(cacheKey, items, 3600);

      return reply.send(items);
    },
  });

  // GET /banners/:id
  fastify.get("/banners/:id", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const cacheKey = `banners:id:${id}`;

      // Cek cache
      const cached = await fastify.cache.get<any>(cacheKey);
      if (cached) return reply.send(cached);

      const banner = await fastify.prisma.banners.findUnique({
        where: { id: Number(id) },
      });

      if (!banner) {
        return reply.status(404).send({ message: "Banner tidak ditemukan." });
      }

      // Simpan cache TTL 1 jam
      await fastify.cache.set(cacheKey, banner, 3600);

      return reply.send(banner);
    },
  });

  // POST /banners
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

      // Invalidasi cache list
      await invalidateBannerCache(fastify);

      return reply.status(201).send({
        message: "Banner berhasil dibuat.",
        banner,
      });
    },
  });

  // PUT /banners/:id
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

      // Invalidasi cache list + cache spesifik id ini
      await invalidateBannerCache(fastify);
      await fastify.cache.del(`banners:id:${id}`);

      return reply.send({
        message: "Banner berhasil diperbarui.",
        banner,
      });
    },
  });

  // DELETE /banners/:id
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

      // Invalidasi cache list + cache spesifik id ini
      await invalidateBannerCache(fastify);
      await fastify.cache.del(`banners:id:${id}`);

      return reply.send({
        message: "Banner berhasil dihapus.",
      });
    },
  });
}
