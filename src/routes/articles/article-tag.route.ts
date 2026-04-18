import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../plugins/authMiddleware";
import { FastInstance } from "../../utils/fastify";
import { ensureAdmin } from "../../utils/auth";

const TagSchema = z.object({
  name: z.string().trim().min(1, "Name wajib diisi").max(100),
  slug: z.string().trim().min(1, "Slug wajib diisi").max(100),
  description: z.string().trim().max(500).optional(),
  color: z.string().trim().max(20).optional().default("#f5c518"),
  featured: z.boolean().optional().default(false),
});

const UpdateTagSchema = TagSchema.partial();

function forbidNonAdmin(req: any, reply: FastifyReply) {
  if (!ensureAdmin(req.user)) {
    reply.status(403).send({ message: "Forbidden" });
    return true;
  }
  return false;
}

export default async function articleTagRoute(fastify: FastInstance) {
  // GET /article-tags (public)
  fastify.get("/article-tags", {
    handler: async (_req: FastifyRequest, reply: FastifyReply) => {
      const tags = await fastify.prisma.tag.findMany({
        orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
        include: {
          articles: {
            include: {
              article: {
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  status: true,
                  createdAt: true,
                },
              },
            },
            where: {
              article: {
                status: "PUBLISHED",
              },
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      });

      return reply.send({
        status: 200,
        data: tags.map((tag) => ({
          ...tag,
          articles: tag.articles.map((at) => at.article),
        })),
      });
    },
  });

  // GET /article-tags/:id (public)
  fastify.get("/article-tags/:id", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };

      const tag = await fastify.prisma.tag.findUnique({
        where: { id },
        include: {
          articles: {
            include: {
              article: {
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
              },
            },
            where: {
              article: {
                status: "PUBLISHED",
              },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!tag) {
        return reply.status(404).send({ message: "Tag tidak ditemukan." });
      }

      return reply.send({
        status: 200,
        data: {
          ...tag,
          articles: tag.articles.map((at) => at.article),
        },
      });
    },
  });

  // GET /article-tags/slug/:slug (public)
  fastify.get("/article-tags/slug/:slug", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { slug } = req.params as { slug: string };

      const tag = await fastify.prisma.tag.findUnique({
        where: { slug },
        include: {
          articles: {
            include: {
              article: {
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
              },
            },
            where: {
              article: {
                status: "PUBLISHED",
              },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!tag) {
        return reply.status(404).send({ message: "Tag tidak ditemukan." });
      }

      return reply.send({
        status: 200,
        data: {
          ...tag,
          articles: tag.articles.map((at) => at.article),
        },
      });
    },
  });

  // POST /article-tags (admin only)
  fastify.post("/article-tags", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const parsed = TagSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      const existingSlug = await fastify.prisma.tag.findUnique({
        where: { slug: parsed.data.slug },
      });

      if (existingSlug) {
        return reply.status(409).send({ message: "Slug sudah digunakan." });
      }

      const tag = await fastify.prisma.tag.create({
        data: {
          name: parsed.data.name,
          slug: parsed.data.slug,
          description: parsed.data.description || null,
          color: parsed.data.color,
          featured: parsed.data.featured,
        },
      });

      return reply.status(201).send({
        status: 201,
        data: {
          message: "Tag berhasil dibuat.",
          tag,
        },
      });
    },
  });

  // PUT /article-tags/:id (admin only)
  fastify.put("/article-tags/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const { id } = req.params as { id: string };

      const tag = await fastify.prisma.tag.findUnique({
        where: { id },
      });

      if (!tag) {
        return reply.status(404).send({ message: "Tag tidak ditemukan." });
      }

      const parsed = UpdateTagSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      // Check slug uniqueness jika diubah
      if (parsed.data.slug && parsed.data.slug !== tag.slug) {
        const existingSlug = await fastify.prisma.tag.findUnique({
          where: { slug: parsed.data.slug },
        });

        if (existingSlug) {
          return reply.status(409).send({ message: "Slug sudah digunakan." });
        }
      }

      const updated = await fastify.prisma.tag.update({
        where: { id },
        data: {
          name: parsed.data.name || tag.name,
          slug: parsed.data.slug || tag.slug,
          description: parsed.data.description || tag.description,
          color: parsed.data.color || tag.color,
          featured: parsed.data.featured || tag.featured,
        },
      });

      return reply.send({
        status: 200,
        data: {
          message: "Tag berhasil diperbarui.",
          tag: updated,
        },
      });
    },
  });

  // DELETE /article-tags/:id (admin only)
  fastify.delete("/article-tags/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const { id } = req.params as { id: string };

      const tag = await fastify.prisma.tag.findUnique({
        where: { id },
        include: {
          articles: {
            select: { articleId: true, tagId: true },
          },
        },
      });

      if (!tag) {
        return reply.status(404).send({ message: "Tag tidak ditemukan." });
      }

      // Count how many articles use this tag
      const articleCount = await fastify.prisma.articleTag.count({
        where: { tagId: id },
      });

      if (articleCount > 0) {
        return reply.status(409).send({
          message:
            "Tag tidak dapat dihapus karena masih digunakan oleh artikel.",
        });
      }

      // Delete all related ArticleTag records first
      await fastify.prisma.articleTag.deleteMany({
        where: { tagId: id },
      });

      await fastify.prisma.tag.delete({
        where: { id },
      });

      return reply.send({
        status: 200,
        data: {
          message: "Tag berhasil dihapus.",
        },
      });
    },
  });
}
