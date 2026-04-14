import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authMiddleware } from "../plugins/authMiddleware";
import { FastInstance } from "../utils/fastify";
import { ensureAdmin } from "../utils/auth";
import { convertBigIntAndDate } from "./products.route";

const DiscTypeEnum = z.enum(["flat", "percent"]);

const PromotionSchema = z.object({
  code: z.string().trim().min(1, "Kode promo wajib diisi").max(100),
  title: z.string().trim().min(1, "Judul promo wajib diisi").max(255),
  productId: z.string().trim().optional().or(z.literal("")),
  categoryId: z.string().trim().optional().or(z.literal("")),
  subCategoryId: z.string().trim().optional().or(z.literal("")),
  active: z.boolean().optional().default(true),
  allowFlashSale: z.boolean().optional().default(false),
  maxUse: z.coerce.number().int().min(1).optional().default(5),
  used: z.coerce.number().int().min(0).optional().default(0),
  discType: DiscTypeEnum,
  value: z.coerce.number().min(0, "Nilai promo tidak valid"),
  minTrx: z
    .union([z.coerce.number().int().min(0), z.null()])
    .optional()
    .default(1000),
  maxDiscount: z
    .union([z.coerce.number().int().min(0), z.null()])
    .optional()
    .default(0),
  userId: z.string().trim().optional().or(z.literal("")),
  expiredDate: z.union([z.string().trim(), z.null()]).optional(),
});

function forbidNonAdmin(req: any, reply: FastifyReply) {
  if (!ensureAdmin(req.user)) {
    reply.status(403).send({ message: "Forbidden" });
    return true;
  }
  return false;
}

function toNullableString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeDate(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return { error: "Tanggal expired tidak valid." } as const;
  }

  return parsed;
}

async function validateRelations(fastify: FastInstance, data: z.infer<typeof PromotionSchema>) {
  if (data.productId) {
    const exists = await fastify.prisma.products.findUnique({
      where: { id: data.productId },
      select: { id: true },
    });
    if (!exists) return "Produk promo tidak ditemukan.";
  }

  if (data.categoryId) {
    const exists = await fastify.prisma.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    });
    if (!exists) return "Kategori promo tidak ditemukan.";
  }

  if (data.subCategoryId) {
    const exists = await fastify.prisma.subCategory.findUnique({
      where: { id: data.subCategoryId },
      select: { id: true, categoryId: true },
    });
    if (!exists) return "Sub kategori promo tidak ditemukan.";

    if (data.categoryId && exists.categoryId !== data.categoryId) {
      return "Sub kategori tidak cocok dengan kategori yang dipilih.";
    }
  }

  if (data.userId) {
    const exists = await fastify.prisma.user.findUnique({
      where: { id: data.userId },
      select: { id: true },
    });
    if (!exists) return "User promo tidak ditemukan.";
  }

  return null;
}

function buildPromotionPayload(data: z.infer<typeof PromotionSchema>) {
  const expiredDate = normalizeDate(data.expiredDate ?? null);
  if (typeof expiredDate === "object" && "error" in expiredDate) {
    return expiredDate;
  }

  return {
    code: data.code.trim().toUpperCase(),
    title: data.title.trim(),
    productId: toNullableString(data.productId),
    categoryId: toNullableString(data.categoryId),
    subCategoryId: toNullableString(data.subCategoryId),
    active: data.active,
    allowFlashSale: data.allowFlashSale,
    maxUse: data.maxUse,
    used: data.used,
    discType: data.discType,
    value: Math.round(data.value),
    minTrx: data.minTrx ?? null,
    maxDiscount: data.maxDiscount ?? null,
    userId: toNullableString(data.userId),
    expiredDate,
  };
}

export default async function promotionRoute(fastify: FastInstance) {
  fastify.get("/promotions", {
    handler: async (_req: FastifyRequest, reply: FastifyReply) => {
      const promotions = await fastify.prisma.promotionsCode.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });

      return reply.send(convertBigIntAndDate(promotions));
    },
  });

  fastify.get("/promotions/:id", {
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const promotionId = Number(id);

      if (!Number.isInteger(promotionId) || promotionId <= 0) {
        return reply.status(400).send({ message: "ID promotion tidak valid." });
      }

      const promotion = await fastify.prisma.promotionsCode.findUnique({
        where: { id: promotionId },
      });

      if (!promotion) {
        return reply.status(404).send({ message: "Promotion tidak ditemukan." });
      }

      return reply.send(convertBigIntAndDate(promotion));
    },
  });

  fastify.post("/promotions", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const parsed = PromotionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      const payload = buildPromotionPayload(parsed.data);
      if (typeof payload === "object" && "error" in payload) {
        return reply.status(400).send({ message: payload.error });
      }

      if (payload.discType === "percent" && payload.value > 100) {
        return reply.status(400).send({
          message: "Diskon percent maksimal 100.",
        });
      }

      const relationError = await validateRelations(fastify, parsed.data);
      if (relationError) {
        return reply.status(400).send({ message: relationError });
      }

      const exists = await fastify.prisma.promotionsCode.count({
        where: { code: payload.code },
      });

      if (exists > 0) {
        return reply.status(409).send({ message: "Kode promo sudah ada." });
      }

      const promotion = await fastify.prisma.promotionsCode.create({
        data: payload,
      });

      return reply.status(201).send({
        message: "Promotion berhasil dibuat.",
        promotion: convertBigIntAndDate(promotion),
      });
    },
  });

  fastify.put("/promotions/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const promotionId = Number(id);

      if (!Number.isInteger(promotionId) || promotionId <= 0) {
        return reply.status(400).send({ message: "ID promotion tidak valid." });
      }

      const existing = await fastify.prisma.promotionsCode.findUnique({
        where: { id: promotionId },
      });

      if (!existing) {
        return reply.status(404).send({ message: "Promotion tidak ditemukan." });
      }

      const parsed = PromotionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      const payload = buildPromotionPayload(parsed.data);
      if (typeof payload === "object" && "error" in payload) {
        return reply.status(400).send({ message: payload.error });
      }

      if (payload.discType === "percent" && payload.value > 100) {
        return reply.status(400).send({
          message: "Diskon percent maksimal 100.",
        });
      }

      const relationError = await validateRelations(fastify, parsed.data);
      if (relationError) {
        return reply.status(400).send({ message: relationError });
      }

      const duplicate = await fastify.prisma.promotionsCode.count({
        where: {
          id: { not: promotionId },
          code: payload.code,
        },
      });

      if (duplicate > 0) {
        return reply.status(409).send({ message: "Kode promo sudah ada." });
      }

      const promotion = await fastify.prisma.promotionsCode.update({
        where: { id: promotionId },
        data: payload,
      });

      return reply.send({
        message: "Promotion berhasil diperbarui.",
        promotion: convertBigIntAndDate(promotion),
      });
    },
  });

  fastify.delete("/promotions/:id", {
    preHandler: authMiddleware,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      if (forbidNonAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const promotionId = Number(id);

      if (!Number.isInteger(promotionId) || promotionId <= 0) {
        return reply.status(400).send({ message: "ID promotion tidak valid." });
      }

      const existing = await fastify.prisma.promotionsCode.findUnique({
        where: { id: promotionId },
      });

      if (!existing) {
        return reply.status(404).send({ message: "Promotion tidak ditemukan." });
      }

      await fastify.prisma.promotionsCode.delete({
        where: { id: promotionId },
      });

      return reply.send({
        message: "Promotion berhasil dihapus.",
      });
    },
  });
}
