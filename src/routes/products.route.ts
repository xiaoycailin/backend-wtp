import {
  authMiddleware,
  optionalAuthMiddleware,
} from "../plugins/authMiddleware";
import { FastInstance, slugify } from "../utils/fastify";

/**
 * Helper: serialise BigInt and Date values that Prisma returns into
 * JSON-safe types.  Registered as Prisma middleware.
 *
 * BUG-FIX: Moved the `$use` middleware registration into the global Prisma
 * plugin so it's only registered once. Registering it inside the route plugin
 * meant it was added every time `productRoutes` was registered and would
 * stack up on hot-reload.
 *
 * The helper is exported so it can be reused from prisma.ts.
 */
export const convertBigIntAndDate = (val: any): any => {
  if (typeof val === "bigint") {
    return val.toString();
  } else if (val instanceof Date) {
    return val.toISOString();
  } else if (Array.isArray(val)) {
    return val.map(convertBigIntAndDate);
  } else if (val && typeof val === "object") {
    return Object.fromEntries(
      Object.entries(val).map(([k, v]) => [k, convertBigIntAndDate(v)]),
    );
  }
  return val;
};

export default async function productRoutes(fastify: FastInstance) {
  const ensureSellerOrAdmin = (user: any, reply: any): boolean => {
    if (!user || (user.role !== "seller" && user.role !== "admin")) {
      reply.status(403).send({
        message: "You do not have permission to perform this action.",
      });
      return false;
    }
    return true;
  };

  const ensureOwnerOrAdmin = (
    user: any,
    ownerId: string,
    reply: any,
  ): boolean => {
    if (user.role !== "admin" && user.id !== ownerId) {
      reply.status(403).send({
        message: "Unauthorized access to product resource.",
      });
      return false;
    }
    return true;
  };

  // ===========================
  // PRODUCT DETAIL
  // ===========================
  fastify.get("/products/:dynamic", {
    preHandler: optionalAuthMiddleware,
    handler: async (req, reply) => {
      const user = req.user;
      const { dynamic } = req.params as { dynamic: string };

      const where: any = {
        OR: [{ id: dynamic }, { slug: dynamic }],
      };

      if (user?.role === "buyer" || !user) {
        where.status = { in: ["PUBLISHED", "AVAILABLE", "SOLD"] };
      }

      const product = await fastify.prisma.products.findFirst({
        where,
        include: {
          sellerUser: { select: { id: true, displayName: true } },
          category: true,
          subCategory: true,
          flashSales: true,
        },
      });

      if (!product) {
        return reply.status(404).send({ message: "Product not found." });
      }

      return reply.send(convertBigIntAndDate(product));
    },
  });

  // ===========================
  // LIST PRODUCTS
  // ===========================
  fastify.get("/products/list", {
    /**
     * BUG-FIX: Replaced inline copy-pasted optional-auth logic with
     * the reusable `optionalAuthMiddleware`.
     */
    preHandler: optionalAuthMiddleware,
    handler: async (req, reply) => {
      const user = req.user;

      const {
        q,
        id,
        category,
        sub,
        status,
        sort,
        page = 1,
        limit = 20,
      } = req.query as any;

      const where: any = {};

      if (q) {
        const search = q.trim();
        where.OR = [
          { title: { contains: search } },
          { slug: { contains: search } },
          { description: { contains: search } },
          { conditionNotes: { contains: search } },
        ];
      }

      if (category) {
        where.categoryId = category.trim();
      }

      if (sub) {
        where.subCategoryId = sub.trim();
      }

      if (status) {
        where.status = status;
      }

      // Buyer / anonymous: restrict visible statuses
      if (user?.role === "buyer" || !user) {
        where.status = {
          in: ["PUBLISHED", "AVAILABLE", "SOLD"],
        };
      }

      if (id) {
        where.id = id;
      }

      /**
       * BUG-FIX: Removed `console.log(where, "\n\n\n", user)`.
       * Debug logging should use the Fastify logger, and certainly not
       * in production code.
       */

      const orderBy: any =
        sort === "latest"
          ? { createdAt: "desc" }
          : sort === "oldest"
            ? { createdAt: "asc" }
            : sort === "low_price"
              ? { price: "asc" }
              : sort === "high_price"
                ? { price: "desc" }
                : { createdAt: "desc" };

      const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
      const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

      const [items, total] = await Promise.all([
        fastify.prisma.products.findMany({
          where,
          orderBy,
          skip,
          take,
          include: {
            sellerUser: { select: { id: true, displayName: true } },
            category: true,
            subCategory: true,
          },
        }),
        fastify.prisma.products.count({ where }),
      ]);

      return reply.send({
        total,
        page: Number(page),
        limit: take,
        items: items.map(convertBigIntAndDate),
      });
    },
  });

  // ===========================
  // CREATE PRODUCT FLASH SALE
  // ===========================
  fastify.post("/products/flashsale", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user;
      if (!user) return;
      if (!ensureSellerOrAdmin(user, reply)) return;

      const { productId, discount, discType } = req.body as any;

      if (!productId) {
        return reply.status(400).send({ message: "productId is required." });
      }

      const newFlashSale = await fastify.prisma.flashSale.create({
        data: {
          productId,
          stock: 10,
          discount,
          discType,
        },
      });

      return reply.status(201).send({
        message: "Product flash sale successfully created.",
        ...convertBigIntAndDate(newFlashSale),
      });
    },
  });

  // ===========================
  // LIST FLASH SALES
  // ===========================
  fastify.get("/products/flashsale", {
    handler: async (_req, reply) => {
      const flashsale = await fastify.prisma.flashSale.findMany({
        where: {
          products: {
            status: {
              in: ["PUBLISHED", "AVAILABLE", "SOLD"],
            },
          },
        },
        include: {
          products: true,
        },
      });

      /**
       * BUG-FIX: Changed status from 201 to 200. GET requests that return
       * data should use 200, not 201 (Created).
       */
      return reply.status(200).send(flashsale.map(convertBigIntAndDate));
    },
  });

  // ===========================
  // CREATE PRODUCT
  // ===========================
  fastify.post("/products", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user;
      if (!user) return;
      if (!ensureSellerOrAdmin(user, reply)) return;

      const {
        title,
        description,
        subCategoryId,
        price,
        currency,
        stock,
        thumbnails,
        conditionNotes,
        special,
      } = req.body as any;

      if (!title || !subCategoryId) {
        return reply.status(400).send({
          message: "Title and subCategoryId are required.",
        });
      }

      const slug = slugify(title);

      const subCategoryExists = await fastify.prisma.subCategory.findUnique({
        where: { id: subCategoryId },
      });
      if (!subCategoryExists) {
        return reply.status(404).send({
          message: "Invalid subCategoryId provided.",
        });
      }

      const newProduct = await fastify.prisma.products.create({
        data: {
          sellerUserId: user.id,
          title,
          slug,
          description,
          categoryId: subCategoryExists.categoryId,
          subCategoryId,
          price: price || 0,
          currency: currency ?? "IDR",
          stock: stock ?? 1,
          thumbnails,
          conditionNotes,
          isSpecial: special,
        },
      });

      return reply.status(201).send({
        message: "Product successfully created.",
        ...convertBigIntAndDate(newProduct),
      });
    },
  });

  // ===========================
  // UPDATE PRODUCT
  // ===========================
  fastify.put("/products/:productId", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const { productId } = req.params as any;
      const user = req.user;

      const product = await fastify.prisma.products.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return reply.status(404).send({ message: "Product not found." });
      }

      if (!ensureOwnerOrAdmin(user, product.sellerUserId, reply)) return;

      const {
        title,
        description,
        categoryId,
        subCategoryId,
        price,
        currency,
        stock,
        thumbnails,
        conditionNotes,
        status,
      } = req.body as any;

      const updateData: any = {};

      if (title) {
        updateData.title = title;
        updateData.slug = slugify(title);
      }

      if (subCategoryId) {
        const subExists = await fastify.prisma.subCategory.findUnique({
          where: { id: subCategoryId },
        });
        if (!subExists) {
          return reply.status(404).send({ message: "Invalid subCategoryId." });
        }
        updateData.subCategoryId = subCategoryId;
      }

      if (categoryId !== undefined) updateData.categoryId = categoryId || null;
      if (description !== undefined) updateData.description = description;
      if (price !== undefined) updateData.price = BigInt(price);
      if (currency !== undefined) updateData.currency = currency;
      if (stock !== undefined) updateData.stock = stock;
      if (thumbnails !== undefined) updateData.thumbnails = thumbnails;
      if (status !== undefined) updateData.status = status;
      if (conditionNotes !== undefined)
        updateData.conditionNotes = conditionNotes;

      const updatedProduct = await fastify.prisma.products.update({
        where: { id: productId },
        data: updateData,
      });

      return reply.send({
        message: "Product updated successfully.",
        ...convertBigIntAndDate(updatedProduct),
      });
    },
  });

  // ===========================
  // DELETE PRODUCT
  // ===========================
  fastify.delete("/products/:productId", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const { productId } = req.params as any;
      const user = req.user;

      const product = await fastify.prisma.products.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return reply.status(404).send({ message: "Product not found." });
      }

      if (!ensureOwnerOrAdmin(user, product.sellerUserId, reply)) return;

      await fastify.prisma.products.delete({
        where: { id: productId },
      });

      return reply.send({
        message: "Product deleted successfully.",
      });
    },
  });

  // ===========================
  // APPROVE PRODUCT
  // ===========================
  fastify.post("/products/approve", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user;

      /**
       * BUG-FIX:
       *  1. Used `===` instead of `==` for strict comparison.
       *  2. Changed status 401 → 403 (Forbidden) for authorization failures.
       *     401 means "not authenticated", 403 means "authenticated but not
       *     allowed".
       *  3. Fixed typo "allready" → "already".
       *  4. Stopped sending raw `Error` objects via `reply.send(new Error(...))`
       *     — Fastify serialises them poorly. Send a plain object instead.
       */
      if (user?.role !== "admin") {
        return reply.status(403).send({
          message: "You do not have permission to perform this action.",
        });
      }

      const { productId } = req.body as any;

      if (!productId) {
        return reply.status(400).send({ message: "productId is required." });
      }

      const product = await fastify.prisma.products.findUnique({
        where: { id: productId, status: "DRAFT" },
      });

      if (!product) {
        return reply.status(409).send({
          message: "Product not found or already approved.",
        });
      }

      const updated = await fastify.prisma.products.update({
        where: { id: productId },
        data: {
          status: "PUBLISHED",
          approvedBy: user.id,
          approvedDate: new Date(),
        },
      });

      return reply.send({
        message: "Product has been approved.",
        ...convertBigIntAndDate(updated),
      });
    },
  });
}
