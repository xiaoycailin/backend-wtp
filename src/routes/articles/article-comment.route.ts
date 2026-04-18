import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../../plugins/authMiddleware";
import { FastInstance } from "../../utils/fastify";
import { ensureAdmin } from "../../utils/auth";

const CommentSchema = z.object({
  content: z.string().trim().min(1, "Content wajib diisi").max(2000),
  parentId: z.string().uuid().optional(),
});

const UpdateCommentSchema = CommentSchema.partial();

export default async function articleCommentRoute(fastify: FastInstance) {
  // GET /articles/:articleId/comments (public)
  fastify.get("/articles/:articleId/comments", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { articleId } = req.params as { articleId: string };
      const {
        page = "1",
        limit = "20",
        parentId,
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const skip = (pageNum - 1) * limitNum;

      const article = await fastify.prisma.article.findUnique({
        where: { id: articleId },
        select: { id: true },
      });

      if (!article) {
        return reply.status(404).send({ message: "Article tidak ditemukan." });
      }

      const where: any = {
        articleId,
        parentId: parentId || null,
      };

      const [total, items] = await Promise.all([
        fastify.prisma.articleComment.count({ where }),
        fastify.prisma.articleComment.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limitNum,
          include: {
            user: {
              select: {
                id: true,
                email: true,
                displayName: true,
              },
            },
            replies: {
              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    displayName: true,
                  },
                },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        }),
      ]);

      return reply.send({
        status: 200,
        data: {
          items,
          meta: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum) || 1,
          },
        },
      });
    },
  });

  // POST /articles/:articleId/comments (auth required)
  fastify.post("/articles/:articleId/comments", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { articleId } = req.params as { articleId: string };
      const userId = req.user?.id;

      if (!userId) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const article = await fastify.prisma.article.findUnique({
        where: { id: articleId },
      });

      if (!article) {
        return reply.status(404).send({ message: "Article tidak ditemukan." });
      }

      const parsed = CommentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      // Validate parent comment jika ada
      if (parsed.data.parentId) {
        const parentComment = await fastify.prisma.articleComment.findUnique({
          where: { id: parsed.data.parentId },
        });

        if (!parentComment || parentComment.articleId !== articleId) {
          return reply.status(400).send({
            message: "Parent comment tidak valid.",
          });
        }
      }

      const comment = await fastify.prisma.articleComment.create({
        data: {
          articleId,
          userId,
          content: parsed.data.content,
          parentId: parsed.data.parentId,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          },
        },
      });

      // Update commentsCount
      await fastify.prisma.article.update({
        where: { id: articleId },
        data: { commentsCount: article.commentsCount + 1 },
      });

      return reply.status(201).send({
        status: 201,
        data: {
          message: "Comment berhasil dibuat.",
          comment,
        },
      });
    },
  });

  // PUT /articles/comments/:id (auth required)
  fastify.put("/articles/comments/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const userId = req.user?.id;

      if (!userId) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const comment = await fastify.prisma.articleComment.findUnique({
        where: { id },
        include: {
          user: {
            select: { id: true },
          },
        },
      });

      if (!comment) {
        return reply.status(404).send({ message: "Comment tidak ditemukan." });
      }

      // Admin bisa edit semua comment, user hanya edit comment sendiri
      if (!ensureAdmin(req.user) && comment.userId !== userId) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      const parsed = UpdateCommentSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      const updated = await fastify.prisma.articleComment.update({
        where: { id },
        data: {
          content: parsed.data.content || comment.content,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
            },
          },
        },
      });

      return reply.send({
        status: 200,
        data: {
          message: "Comment berhasil diperbarui.",
          comment: updated,
        },
      });
    },
  });

  // DELETE /articles/comments/:id (auth required)
  fastify.delete("/articles/comments/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const userId = req.user?.id;

      if (!userId) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const comment = await fastify.prisma.articleComment.findUnique({
        where: { id },
        include: {
          article: {
            select: { id: true, commentsCount: true },
          },
          replies: {
            select: { id: true },
          },
          user: {
            select: { id: true },
          },
        },
      });

      if (!comment) {
        return reply.status(404).send({ message: "Comment tidak ditemukan." });
      }

      // Admin bisa delete semua comment, user hanya delete comment sendiri
      if (!ensureAdmin(req.user) && comment.userId !== userId) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      // Delete replies first jika ada
      if (comment.replies.length > 0) {
        await fastify.prisma.articleComment.deleteMany({
          where: { parentId: id },
        });
      }

      await fastify.prisma.articleComment.delete({
        where: { id },
      });

      // Update commentsCount
      const totalCommentsDeleted = comment.replies.length + 1;
      await fastify.prisma.article.update({
        where: { id: comment.article.id },
        data: {
          commentsCount: comment.article.commentsCount - totalCommentsDeleted,
        },
      });

      return reply.send({
        status: 200,
        data: {
          message: "Comment berhasil dihapus.",
        },
      });
    },
  });
}
