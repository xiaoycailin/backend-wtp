import { authMiddleware } from "../plugins/authMiddleware";
import { FastInstance, slugify } from "../utils/fastify";
import { convertBigIntAndDate } from "./products.route";
// import { cacheMiddleware } from "../utils/cache-utils";
import type { FastifyRequest, FastifyReply } from "fastify";

export default async function (fastify: FastInstance) {
  const ensureAdmin = (user: any, reply: any): boolean => {
    if (!user || user.role !== "admin") {
      reply.status(403).send({
        message: "You do not have permission to perform this action.",
      });
      return false;
    }
    return true;
  };

  const validateName = (name: string, reply: any): boolean => {
    if (!name || name.trim().length === 0) {
      reply.status(400).send({
        message: "Category name cannot be empty.",
      });
      return false;
    }
    return true;
  };

  fastify.get("/category", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { productInclude } = req.query as any;
      const includePriceFrom = productInclude === "true";

      try {
        const categories = await fastify.prisma.category.findMany({
          orderBy: {
            position: "asc",
          },
          include: {
            subCategories: {
              orderBy: { position: "asc" },
              select: {
                badge: true,
                banners: true,
                brand: true,
                categoryId: true,
                createdAt: true,
                thumbnail: true,
                title: true,
                slug: true,
                id: true,
                instant: true,
                popular: true,
                ...(includePriceFrom && {
                  products: {
                    where: {
                      status: { in: ["PUBLISHED", "AVAILABLE", "SOLD"] },
                    },
                    select: { price: true },
                    orderBy: { price: "asc" },
                    take: 1,
                  },
                }),
              },
            },
          },
        });

        // map ke priceFrom dan buang products
        const result = categories.map((cat) => ({
          ...cat,
          subCategories: cat.subCategories.map((sub: any) => {
            const priceFrom =
              includePriceFrom && sub.products?.[0]?.price != null
                ? sub.products[0].price
                : null;

            const { products, ...rest } = sub;
            return { ...rest, priceFrom };
          }),
        }));

        return reply.send(convertBigIntAndDate(result));
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({
          message: "Internal server error",
        });
      }
    },
  });

  fastify.get("/category/sub", {
    // preHandler: cacheMiddleware(fastify, 600),
    handler: async (_req: FastifyRequest, reply: FastifyReply) => {
      const subCategories = await fastify.prisma.subCategory.findMany({
        include: {
          category: true,
        },
      });

      return reply.send(subCategories);
    },
  });

  fastify.get("/category/sub/:dynamic", {
    handler: async (req, reply) => {
      const { dynamic } = req.params as { dynamic: string };
      const { productInclude } = req.query as any;

      const key = dynamic.trim();

      if (!key) {
        return reply.status(400).send({
          message: "Invalid parameter.",
        });
      }

      const subCategories = await fastify.prisma.subCategory.findMany({
        where: {
          OR: [{ categoryId: key }, { slug: key }],
        },
        include: {
          category: true,
          products:
            productInclude === "true"
              ? {
                  where: {
                    status: {
                      in: ["PUBLISHED", "AVAILABLE", "SOLD"],
                    },
                  },
                  orderBy: {
                    price: "asc",
                  },
                  include: {
                    flashSales: {
                      select: {
                        discount: true,
                        id: true,
                        stock: true,
                        sellCount: true,
                        discType: true,
                      },
                    },
                  },
                }
              : false,
        },
      });

      if (subCategories.length === 0) {
        return reply.status(404).send({
          message: "No sub-categories found for the given parameter.",
        });
      }

      /**
       * BUG-FIX: Apply BigInt conversion so `price` / `discount` fields in
       * included products don't cause JSON serialisation errors.
       */
      return reply.send(subCategories.map(convertBigIntAndDate));
    },
  });

  fastify.post("/category", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user;
      if (!ensureAdmin(user, reply)) return;

      const { title } = req.body as any;
      if (!validateName(title, reply)) return;

      const slug = slugify(title);

      const exists = await fastify.prisma.category.count({
        where: { OR: [{ slug }, { title }] },
      });

      if (exists > 0) {
        return reply.status(409).send({
          message:
            "Category name already exists. Please choose a different name.",
        });
      }

      const newCategory = await fastify.prisma.category.create({
        data: { title, slug },
      });

      return reply.status(201).send({
        message: "Category created successfully.",
        ...newCategory,
      });
    },
  });

  // Create sub category
  fastify.post("/category/sub/:categoryId", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user;
      if (!ensureAdmin(user, reply)) return;

      const { categoryId } = req.params as any;
      const { title, thumbnail, description, banners, brand, badgeId } =
        req.body as any;
      if (!validateName(title, reply)) return;

      const slug = slugify(title);

      const category = await fastify.prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!category) {
        return reply.status(404).send({
          message: "Category not found.",
        });
      }

      const exists = await fastify.prisma.subCategory.count({
        where: {
          categoryId,
          OR: [{ slug }, { title }],
        },
      });

      if (exists > 0) {
        return reply.status(409).send({
          message:
            "Sub-category name already exists. Please choose a different name.",
        });
      }

      const newSubCategory = await fastify.prisma.subCategory.create({
        data: {
          title,
          slug,
          categoryId,
          brand,
          banners,
          description,
          thumbnail,
          badgeId: badgeId ? Number(badgeId) : null,
        },
      });

      return reply.status(201).send({
        message: "Sub-category created successfully.",
        ...newSubCategory,
      });
    },
  });

  // ===========================
  // UPDATE CATEGORY
  // ===========================
  fastify.put("/category/:categoryId", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user;
      if (!ensureAdmin(user, reply)) return;

      const { categoryId } = req.params as any;
      const { title, updatedAt, position } = req.body as any; // TAMBAH position

      if (title !== undefined) {
        if (!validateName(title, reply)) return;
      }

      const exists = await fastify.prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!exists) {
        return reply.status(404).send({ message: "Category not found." });
      }

      // cek konflik hanya kalau title diisi
      if (title !== undefined) {
        const slug = slugify(title);
        const conflict = await fastify.prisma.category.count({
          where: {
            id: { not: categoryId },
            OR: [{ slug }, { title }],
          },
        });

        if (conflict > 0) {
          return reply.status(409).send({
            message: "Another category already uses this name.",
          });
        }

        const updated = await fastify.prisma.category.update({
          where: { id: categoryId },
          data: {
            title,
            slug: slugify(title),
            ...(updatedAt !== undefined && { updatedAt }),
            ...(position !== undefined && { position }),
          },
        });

        return reply.send({
          message: "Category updated successfully.",
          ...updated,
        });
      }

      // kalau hanya update position (tanpa title)
      const updated = await fastify.prisma.category.update({
        where: { id: categoryId },
        data: {
          ...(updatedAt !== undefined && { updatedAt }),
          ...(position !== undefined && { position }),
        },
      });

      return reply.send({
        message: "Category updated successfully.",
        ...updated,
      });
    },
  });

  // ===========================
  // REORDER CATEGORIES (BATCH)
  // ===========================
  fastify.put("/category/reorder", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user;
      if (!ensureAdmin(user, reply)) return;

      const { order } = req.body as {
        order: { id: string; position: number }[];
      };

      if (!Array.isArray(order) || order.length === 0) {
        return reply.status(400).send({ message: "order harus berupa array." });
      }

      // batch update pakai transaction
      await fastify.prisma.$transaction(
        order.map(({ id, position }) =>
          fastify.prisma.category.update({
            where: { id },
            data: { position },
          }),
        ),
      );

      return reply.send({ message: "Category order updated successfully." });
    },
  });

  // Reorder sub kategori — tambah di backend
  fastify.put("/category/sub/reorder/:categoryId", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user;
      if (!ensureAdmin(user, reply)) return;

      const { categoryId } = req.params as any;
      const { order } = req.body as {
        order: { id: string; position: number }[];
      };

      if (!Array.isArray(order) || !order.length) {
        return reply.status(400).send({ message: "order harus berupa array." });
      }

      await fastify.prisma.$transaction(
        order.map(({ id, position }) =>
          fastify.prisma.subCategory.update({
            where: { id, categoryId },
            data: { position },
          }),
        ),
      );

      return reply.send({ message: "Sub category order updated." });
    },
  });

  // ===========================
  // DELETE CATEGORY
  // ===========================
  fastify.delete("/category/:categoryId", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user;
      if (!ensureAdmin(user, reply)) return;

      const { categoryId } = req.params as any;

      const exists = await fastify.prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!exists) {
        return reply.status(404).send({ message: "Category not found." });
      }

      await fastify.prisma.subCategory.deleteMany({
        where: { categoryId },
      });

      const deleted = await fastify.prisma.category.delete({
        where: { id: categoryId },
      });

      return reply.send({
        message: "Category deleted successfully.",
        data: deleted,
      });
    },
  });

  // ===========================
  // UPDATE SUBCATEGORY
  // ===========================
  fastify.put("/category/sub/:subId", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user;
      if (!ensureAdmin(user, reply)) return;

      const { subId } = req.params as any;
      const {
        title,
        categoryId,
        thumbnail,
        description,
        banners,
        brand,
        badgeId,
      } = req.body as any;

      if (!validateName(title, reply)) return;

      const slug = slugify(title);

      const subCategory = await fastify.prisma.subCategory.findUnique({
        where: { id: subId },
      });

      if (!subCategory) {
        return reply.status(404).send({
          message: "Sub-category not found.",
        });
      }

      const newCategoryId = categoryId || subCategory.categoryId;

      const conflict = await fastify.prisma.subCategory.count({
        where: {
          id: { not: subId },
          categoryId: newCategoryId,
          OR: [{ slug }, { title }],
        },
      });

      if (conflict > 0) {
        return reply.status(409).send({
          message:
            "A sub-category with the same name already exists in this category.",
        });
      }

      const updated = await fastify.prisma.subCategory.update({
        where: { id: subId },
        data: {
          title,
          slug,
          thumbnail,
          banners,
          description,
          brand,
          categoryId: newCategoryId,
          badgeId: badgeId ? Number(badgeId) : null,
        },
      });

      return reply.send({
        message: "Sub-category updated successfully.",
        ...updated,
      });
    },
  });

  // ===========================
  // DELETE SUBCATEGORY
  // ===========================
  fastify.delete("/category/sub/:subId", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user;
      if (!ensureAdmin(user, reply)) return;

      const { subId } = req.params as any;

      const exists = await fastify.prisma.subCategory.findUnique({
        where: { id: subId },
      });

      if (!exists) {
        return reply.status(404).send({ message: "Sub-category not found." });
      }

      const deleted = await fastify.prisma.subCategory.delete({
        where: { id: subId },
      });

      return reply.send({
        message: "Sub-category deleted successfully.",
        data: deleted,
      });
    },
  });
}
