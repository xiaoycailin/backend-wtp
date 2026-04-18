import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../plugins/authMiddleware";
import { FastInstance } from "../../utils/fastify";
import { ensureAdmin } from "../../utils/auth";

const CategorySchema = z.object({
  name: z.string().trim().min(1, "Name wajib diisi").max(100),
  slug: z.string().trim().min(1, "Slug wajib diisi").max(100),
  description: z.string().trim().max(500).optional(),
  thumbnail: z.string().trim().max(500).optional(),
});

const UpdateCategorySchema = CategorySchema.partial();

function forbidNonAdmin(req: any, reply: FastifyReply) {
  if (!ensureAdmin(req.user)) {
    reply.status(403).send({ message: "Forbidden" });
    return true;
  }
  return false;
}

export default async function articleCategoryRoute(fastify: FastInstance) {
  // GET /article-categories (public)
  fastify.get("/article-categories", {
    handler: async (_req: FastifyRequest, reply: FastifyReply) => {
      const categories = await fastify.prisma.articleCategory.findMany({
        orderBy: [{ createdAt: "desc" }],
        include: {
          articles: {
            select: {
              id: true,
              title: true,
              slug: true,
              status: true,
              createdAt: true,
            },
            where: {
              status: "PUBLISHED",
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      });

      return reply.send({
        status: 200,
        data: categories,
      });
    },
  });

  // GET /article-categories/:id (public)
  fastify.get("/article-categories/:id", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };

      const category = await fastify.prisma.articleCategory.findUnique({
        where: { id },
        include: {
          articles: {
            select: {
              id: true,
              title: true,
              slug: true,
              excerpt: true,
              thumbnail: true,
              status: true,
              createdAt: true,
              views: true,
              likesCount: true,
              commentsCount: true,
            },
            where: {
              status: "PUBLISHED",
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!category) {
        return reply.status(404).send({ message: "Category tidak ditemukan." });
      }

      return reply.send({
        status: 200,
        data: category,
      });
    },
  });

  // GET /article-categories/slug/:slug (public)
  fastify.get("/article-categories/slug/:slug", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { slug } = req.params as { slug: string };

      const category = await fastify.prisma.articleCategory.findUnique({
        where: { slug },
        include: {
          articles: {
            select: {
              id: true,
              title: true,
              slug: true,
              excerpt: true,
              thumbnail: true,
              status: true,
              createdAt: true,
              views: true,
              likesCount: true,
              commentsCount: true,
            },
            where: {
              status: "PUBLISHED",
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!category) {
        return reply.status(404).send({ message: "Category tidak ditemukan." });
      }

      return reply.send({
        status: 200,
        data: category,
      });
    },
  });

  // POST /article-categories (admin only)
  fastify.post("/article-categories", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const parsed = CategorySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      const existingSlug = await fastify.prisma.articleCategory.findUnique({
        where: { slug: parsed.data.slug },
      });

      if (existingSlug) {
        return reply.status(409).send({ message: "Slug sudah digunakan." });
      }

      const category = await fastify.prisma.articleCategory.create({
        data: {
          name: parsed.data.name,
          slug: parsed.data.slug,
          description: parsed.data.description || null,
          thumbnail: parsed.data.thumbnail || null,
        },
      });

      return reply.status(201).send({
        status: 201,
        data: {
          message: "Category berhasil dibuat.",
          category,
        },
      });
    },
  });

  // PUT /article-categories/:id (admin only)
  fastify.put("/article-categories/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const { id } = req.params as { id: string };

      const category = await fastify.prisma.articleCategory.findUnique({
        where: { id },
      });

      if (!category) {
        return reply.status(404).send({ message: "Category tidak ditemukan." });
      }

      const parsed = UpdateCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      // Check slug uniqueness jika diubah
      if (parsed.data.slug && parsed.data.slug !== category.slug) {
        const existingSlug = await fastify.prisma.articleCategory.findUnique({
          where: { slug: parsed.data.slug },
        });

        if (existingSlug) {
          return reply.status(409).send({ message: "Slug sudah digunakan." });
        }
      }

      const updated = await fastify.prisma.articleCategory.update({
        where: { id },
        data: {
          name: parsed.data.name || category.name,
          slug: parsed.data.slug || category.slug,
          description: parsed.data.description || category.description,
          thumbnail: parsed.data.thumbnail || category.thumbnail,
        },
      });

      return reply.send({
        status: 200,
        data: {
          message: "Category berhasil diperbarui.",
          category: updated,
        },
      });
    },
  });

  // DELETE /article-categories/:id (admin only)
  fastify.delete("/article-categories/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const { id } = req.params as { id: string };

      const category = await fastify.prisma.articleCategory.findUnique({
        where: { id },
        include: {
          articles: {
            select: { id: true },
          },
        },
      });

      if (!category) {
        return reply.status(404).send({ message: "Category tidak ditemukan." });
      }

      if (category.articles.length > 0) {
        return reply.status(409).send({
          message:
            "Category tidak dapat dihapus karena masih memiliki artikel.",
        });
      }

      await fastify.prisma.articleCategory.delete({
        where: { id },
      });

      return reply.send({
        status: 200,
        data: {
          message: "Category berhasil dihapus.",
        },
      });
    },
  });
}
