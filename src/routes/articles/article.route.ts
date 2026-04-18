import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../plugins/authMiddleware";
import { FastInstance } from "../../utils/fastify";
import { ensureAdmin } from "../../utils/auth";

const ArticleSchema = z.object({
  title: z.string().trim().min(1, "Title wajib diisi").max(200),
  slug: z.string().trim().min(1, "Slug wajib diisi").max(200),
  content: z.string().trim().min(1, "Content wajib diisi"),
  excerpt: z.string().trim().max(500).optional(),
  thumbnail: z.string().trim().max(500).optional(),
  categoryId: z.string().uuid().optional(),
  status: z
    .enum(["DRAFT", "PUBLISHED", "ARCHIVED"])
    .optional()
    .default("DRAFT"),
  metaTitle: z.string().trim().max(100).optional(),
  metaDescription: z.string().trim().max(200).optional(),
  metaKeywords: z.string().trim().max(500).optional(),
  ogImage: z.string().trim().max(500).optional(),
  featuredImages: z.any().optional(),
  tags: z.array(z.string().uuid()).optional(),
});

const UpdateArticleSchema = ArticleSchema.partial();

function forbidNonAdmin(req: any, reply: FastifyReply) {
  if (!ensureAdmin(req.user)) {
    reply.status(403).send({ message: "Forbidden" });
    return true;
  }
  return false;
}

export default async function articleRoute(fastify: FastInstance) {
  // GET /articles (public)
  fastify.get("/articles", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const {
        page = "1",
        limit = "20",
        categoryId,
        tagId,
        status,
        featured,
        pinned,
        search,
        authorId,
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const skip = (pageNum - 1) * limitNum;
      const q = search?.trim();

      const where: any = {
        ...(categoryId ? { categoryId } : {}),
        ...(status ? { status } : {}),
        ...(featured ? { featured: featured === "true" } : {}),
        ...(pinned ? { pinned: pinned === "true" } : {}),
        ...(authorId ? { authorId } : {}),
        ...(tagId
          ? {
              tags: {
                some: {
                  tag: {
                    id: tagId,
                  },
                },
              },
            }
          : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { excerpt: { contains: q } },
                { content: { contains: q } },
                { metaTitle: { contains: q } },
                { metaDescription: { contains: q } },
              ],
            }
          : {}),
      };

      // Untuk public, hanya tampilkan PUBLISHED
      if (!req.user || req.user?.role !== "admin") {
        where.status = "PUBLISHED";
      }

      const [total, items] = await Promise.all([
        fastify.prisma.article.count({ where }),
        fastify.prisma.article.findMany({
          where,
          orderBy: [
            { pinned: "desc" },
            { featured: "desc" },
            { createdAt: "desc" },
          ],
          skip,
          take: limitNum,
          include: {
            author: {
              select: {
                id: true,
                email: true,
                displayName: true,
              },
            },
            category: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
            tags: {
              include: {
                tag: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    color: true,
                  },
                },
              },
            },
          },
        }),
      ]);

      return reply.send({
        items,
        meta: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum) || 1,
        },
      });
    },
  });

  // GET /articles/:id (public)
  fastify.get("/articles/:id", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const where: any = { id };

      // Untuk public, hanya tampilkan PUBLISHED
      if (!req.user || req.user?.role !== "admin") {
        where.status = "PUBLISHED";
      }

      const article = await fastify.prisma.article.findUnique({
        where,
        include: {
          author: {
            select: {
              id: true,
              email: true,
              displayName: true,
              createdAt: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              thumbnail: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          tags: {
            include: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  color: true,
                  description: true,
                },
              },
            },
          },
          comments: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  displayName: true,
                  createdAt: true,
                },
              },
              replies: {
                include: {
                  user: {
                    select: {
                      id: true,
                      email: true,
                      displayName: true,
                      createdAt: true,
                    },
                  },
                },
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy: { createdAt: "desc" },
          },
          likes: {
            select: {
              userId: true,
              createdAt: true,
            },
          },
          bookmarks: {
            select: {
              userId: true,
              createdAt: true,
            },
          },
        },
      });

      if (!article) {
        return reply.status(404).send({ message: "Article tidak ditemukan." });
      }

      // Increment views jika bukan admin
      if (!req.user || req.user?.role !== "admin") {
        await fastify.prisma.article.update({
          where: { id },
          data: { views: article.views + 1 },
        });
      }

      return reply.send({
        status: 200,
        data: article,
      });
    },
  });

  // GET /articles/slug/:slug (public)
  fastify.get("/articles/slug/:slug", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { slug } = req.params as { slug: string };
      const where: any = { slug };

      // Untuk public, hanya tampilkan PUBLISHED
      if (!req.user || req.user?.role !== "admin") {
        where.status = "PUBLISHED";
      }

      const article = await fastify.prisma.article.findUnique({
        where,
        include: {
          author: {
            select: {
              id: true,
              email: true,
              displayName: true,
              createdAt: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              thumbnail: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          tags: {
            include: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  color: true,
                  description: true,
                },
              },
            },
          },
          comments: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  displayName: true,
                  createdAt: true,
                },
              },
              replies: {
                include: {
                  user: {
                    select: {
                      id: true,
                      email: true,
                      displayName: true,
                      createdAt: true,
                    },
                  },
                },
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy: { createdAt: "desc" },
          },
          likes: {
            select: {
              userId: true,
              createdAt: true,
            },
          },
          bookmarks: {
            select: {
              userId: true,
              createdAt: true,
            },
          },
        },
      });

      if (!article) {
        return reply.status(404).send({ message: "Article tidak ditemukan." });
      }

      // Increment views jika bukan admin
      if (!req.user || req.user?.role !== "admin") {
        await fastify.prisma.article.update({
          where: { slug },
          data: { views: article.views + 1 },
        });
      }

      return reply.send({
        status: 200,
        data: article,
      });
    },
  });

  // POST /articles (admin only)
  fastify.post("/articles", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const parsed = ArticleSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      // Check slug uniqueness
      const existingSlug = await fastify.prisma.article.findUnique({
        where: { slug: parsed.data.slug },
      });
      if (existingSlug) {
        return reply.status(409).send({ message: "Slug sudah digunakan." });
      }

      const article = await fastify.prisma.article.create({
        data: {
          title: parsed.data.title,
          slug: parsed.data.slug,
          content: parsed.data.content,
          excerpt: parsed.data.excerpt || null,
          thumbnail: parsed.data.thumbnail || null,
          authorId: req.user?.id,
          categoryId: parsed.data.categoryId || null,
          status: parsed.data.status || "DRAFT",
          metaTitle: parsed.data.metaTitle || null,
          metaDescription: parsed.data.metaDescription || null,
          metaKeywords: parsed.data.metaKeywords || null,
          ogImage: parsed.data.ogImage || null,
          featuredImages: parsed.data.featuredImages || null,
          publishedAt: parsed.data.status === "PUBLISHED" ? new Date() : null,
        },
        include: {
          author: {
            select: {
              id: true,
              email: true,
              displayName: true,
              createdAt: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              thumbnail: true,
            },
          },
          tags: {
            include: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  color: true,
                },
              },
            },
          },
        },
      });

      // Handle tags jika ada
      if (parsed.data.tags && parsed.data.tags.length > 0) {
        await fastify.prisma.articleTag.createMany({
          data: parsed.data.tags.map((tagId) => ({
            articleId: article.id,
            tagId,
          })),
        });
      }

      return reply.status(201).send({
        status: 201,
        data: {
          message: "Article berhasil dibuat.",
          article,
        },
      });
    },
  });

  // PUT /articles/:id (admin only)
  fastify.put("/articles/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const article = await fastify.prisma.article.findUnique({
        where: { id },
      });

      if (!article) {
        return reply.status(404).send({ message: "Article tidak ditemukan." });
      }

      const parsed = UpdateArticleSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      // Check slug uniqueness jika diubah
      if (parsed.data.slug && parsed.data.slug !== article.slug) {
        const existingSlug = await fastify.prisma.article.findUnique({
          where: { slug: parsed.data.slug },
        });

        if (existingSlug) {
          return reply.status(409).send({ message: "Slug sudah digunakan." });
        }
      }

      const updated = await fastify.prisma.article.update({
        where: { id },
        data: {
          title: parsed.data.title || article.title,
          slug: parsed.data.slug || article.slug,
          content: parsed.data.content || article.content,
          excerpt: parsed.data.excerpt || article.excerpt,
          thumbnail: parsed.data.thumbnail || article.thumbnail,
          categoryId: parsed.data.categoryId || article.categoryId,
          status: parsed.data.status || article.status,
          metaTitle: parsed.data.metaTitle || article.metaTitle,
          metaDescription:
            parsed.data.metaDescription || article.metaDescription,
          metaKeywords: parsed.data.metaKeywords || article.metaKeywords,
          ogImage: parsed.data.ogImage || article.ogImage,
          featuredImages: parsed.data.featuredImages || article.featuredImages,
          publishedAt:
            parsed.data.status === "PUBLISHED"
              ? new Date()
              : article.publishedAt,
        },
        include: {
          author: {
            select: {
              id: true,
              email: true,
              displayName: true,
              createdAt: true,
            },
          },
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              thumbnail: true,
            },
          },
          tags: {
            include: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  color: true,
                },
              },
            },
          },
        },
      });

      // Update tags jika ada
      if (parsed.data.tags) {
        // Delete semua tag yang ada
        await fastify.prisma.articleTag.deleteMany({
          where: { articleId: id },
        });

        // Create tag baru jika ada
        if (parsed.data.tags.length > 0) {
          await fastify.prisma.articleTag.createMany({
            data: parsed.data.tags.map((tagId) => ({
              articleId: id,
              tagId,
            })),
          });
        }
      }

      return reply.send({
        status: 200,
        data: {
          message: "Article berhasil diperbarui.",
          article: updated,
        },
      });
    },
  });

  // DELETE /articles/:id (admin only)
  fastify.delete("/articles/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const article = await fastify.prisma.article.findUnique({
        where: { id },
      });

      if (!article) {
        return reply.status(404).send({ message: "Article tidak ditemukan." });
      }

      await fastify.prisma.article.delete({
        where: { id },
      });

      return reply.send({
        status: 200,
        data: {
          message: "Article berhasil dihapus.",
        },
      });
    },
  });

  // POST /articles/:id/like (auth required)
  fastify.post("/articles/:id/like", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const userId = req.user?.id;

      if (!userId) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const article = await fastify.prisma.article.findUnique({
        where: { id },
      });

      if (!article) {
        return reply.status(404).send({ message: "Article tidak ditemukan." });
      }

      const existingLike = await fastify.prisma.articleLike.findUnique({
        where: {
          articleId_userId: {
            articleId: id,
            userId,
          },
        },
      });

      if (existingLike) {
        // Unlike
        await fastify.prisma.articleLike.delete({
          where: {
            articleId_userId: {
              articleId: id,
              userId,
            },
          },
        });

        await fastify.prisma.article.update({
          where: { id },
          data: { likesCount: article.likesCount - 1 },
        });

        return reply.send({
          status: 200,
          data: {
            message: "Like berhasil dihapus.",
            liked: false,
          },
        });
      }

      // Like
      await fastify.prisma.articleLike.create({
        data: {
          articleId: id,
          userId,
        },
      });

      await fastify.prisma.article.update({
        where: { id },
        data: { likesCount: article.likesCount + 1 },
      });

      return reply.send({
        status: 200,
        data: {
          message: "Article berhasil dilike.",
          liked: true,
        },
      });
    },
  });

  // POST /articles/:id/bookmark (auth required)
  fastify.post("/articles/:id/bookmark", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const userId = req.user?.id;

      if (!userId) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const article = await fastify.prisma.article.findUnique({
        where: { id },
      });

      if (!article) {
        return reply.status(404).send({ message: "Article tidak ditemukan." });
      }

      const existingBookmark = await fastify.prisma.articleBookmark.findUnique({
        where: {
          articleId_userId: {
            articleId: id,
            userId,
          },
        },
      });

      if (existingBookmark) {
        // Remove bookmark
        await fastify.prisma.articleBookmark.delete({
          where: {
            articleId_userId: {
              articleId: id,
              userId,
            },
          },
        });

        return reply.send({
          status: 200,
          data: {
            message: "Bookmark berhasil dihapus.",
            bookmarked: false,
          },
        });
      }

      // Add bookmark
      await fastify.prisma.articleBookmark.create({
        data: {
          articleId: id,
          userId,
        },
      });

      return reply.send({
        status: 200,
        data: {
          message: "Article berhasil bookmark.",
          bookmarked: true,
        },
      });
    },
  });
}
