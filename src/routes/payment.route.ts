import { DuitKu, Midtrans } from "../utils/payment";
import { FastInstance } from "../utils/fastify";
import {
  authMiddleware,
  optionalAuthMiddleware,
} from "../plugins/authMiddleware";
import { convertBigIntAndDate } from "./products.route";
import { checkGameId } from "../utils/gameIdChecker";
import { ensureAdmin } from "../utils/auth";
import {
  paymentMethodCreateSchema,
  paymentMethodUpdateSchema,
  paymentPricesSchema,
  paymentPurchaseSchema,
  paymentReviewSchema,
} from "../schemas/payment.schema";
import { createActivityLog } from "../utils/activity-log";
import { createSystemLog } from "../utils/system-log";
import { serializeData } from "../utils/json";
import DigiflazzClient from "../plugins/digiflazz-api";

function computeFlashDiscount(
  basePrice: number,
  flashSale: { discType: string; discount: bigint | number } | null,
): { discount: number; discountLabel: string | null } {
  if (!flashSale) return { discount: 0, discountLabel: null };

  const discValue = Number(flashSale.discount);

  if (flashSale.discType === "flat") {
    return {
      discount: discValue,
      discountLabel: `Potongan Rp ${discValue.toLocaleString("id-ID")}`,
    };
  }

  if (flashSale.discType === "percent") {
    const amount = (basePrice * discValue) / 100;
    return {
      discount: amount,
      discountLabel: `Potongan ${discValue}%`,
    };
  }

  return { discount: 0, discountLabel: null };
}

function computePromoDiscount(
  basePrice: number,
  promo: {
    discType: "flat" | "percent";
    value: bigint | number;
    maxDiscount?: number | null;
  },
): number {
  const promoValue = Number(promo.value ?? 0);
  let amount = 0;

  if (promo.discType === "percent") {
    amount = (basePrice * promoValue) / 100;
  } else {
    amount = promoValue;
  }

  const maxDiscount = Number(promo.maxDiscount ?? 0);
  if (maxDiscount > 0) {
    amount = Math.min(amount, maxDiscount);
  }

  return Math.max(Math.round(amount), 0);
}

function computeFee(
  payment: { feeType: string; feeValue: number },
  discountedPrice: number,
  qty: number,
): number {
  if (payment.feeType === "percent") {
    return (payment.feeValue * discountedPrice * qty) / 100;
  }
  return payment.feeValue;
}

export async function refundToUserBalance(params: {
  tx: any;
  userId?: string | null;
  amount: number;
  ref: string;
  paymentMethodCode?: string | null;
  paymentSource?: string | null;
  meta?: Record<string, any>;
}) {
  console.log("params Refund: ==>>> ", params);

  const { tx, userId, amount, ref, paymentMethodCode, paymentSource, meta } =
    params;
  if (!userId || amount <= 0) return;

  const normalizedCode = (paymentMethodCode ?? "").toLowerCase();
  const balanceType =
    paymentSource === "BALANCE" && normalizedCode.includes("point")
      ? "POINTS"
      : "WALLET";

  const balanceAmount = balanceType === "POINTS" ? amount : BigInt(amount);

  await tx.userBalance.upsert({
    where: {
      userId_type: {
        userId,
        type: balanceType,
      },
    },
    update: {
      amount: {
        increment: balanceAmount,
      },
    },
    create: {
      userId,
      type: balanceType,
      amount: balanceAmount,
    },
  });

  const entryMeta = {
    reason: "digiflazz_failed_refund",
    refundedFrom: paymentSource,
    paymentMethodCode,
    amount,
    ...meta,
  };

  if (balanceType === "POINTS") {
    await tx.pointEntry.create({
      data: {
        userId,
        amount,
        ref,
        meta: entryMeta as any,
      },
    });
  } else {
    await tx.moneyEntry.create({
      data: {
        userId,
        amount: BigInt(amount),
        ref,
        meta: entryMeta as any,
      },
    });
  }
}

async function processSuccessfulOrder(params: {
  fastify: FastInstance;
  tx: any;
  transaction: any;
}) {
  const { fastify, tx, transaction } = params;
  const provider = transaction.product?.provider ?? "digiflazz";

  if (provider !== "digiflazz") {
    fastify.log.info(
      { trxId: transaction.trxId, provider },
      "Manual provider detected, skipping Digiflazz order creation",
    );
    return;
  }

  const df = new DigiflazzClient();
  const userData = (transaction.userAccountData as any) ?? {};

  if (!transaction.skuCode) {
    await tx.transactions.update({
      where: { id: transaction.id },
      data: {
        orderStatus: "FAILED",
      },
    });

    await restorePromotionUsage(tx, transaction);

    await tx.products.update({
      where: { id: transaction.productId ?? "0" },
      data: {
        stock: {
          increment: transaction.quantity,
        },
      },
    });

    if (transaction.flashSaleId) {
      await tx.flashSale.update({
        where: { id: transaction.flashSaleId },
        data: {
          stock: {
            increment: transaction.quantity,
          },
        },
      });
    }

    await refundToUserBalance({
      tx,
      userId: transaction.userId,
      amount: Number(transaction.totalPrice ?? 0),
      ref: transaction.trxId,
      paymentMethodCode: transaction.paymentMethod?.methodCode ?? null,
      paymentSource: transaction.paymentMethod?.source ?? null,
      meta: {
        transactionId: transaction.id,
        productId: transaction.productId,
        reason: "missing_sku_code",
      },
    });

    return;
  }

  try {
    const requestTrx = await df.prepaid.topup(
      transaction.skuCode,
      `${userData.primary_id ?? ""}${userData.server_id ?? ""}`,
      transaction.trxId,
    );
    fastify.log.info(requestTrx, "TRX DIGIFLAZZ");
  } catch (error: any) {
    fastify.log.error(error, "something error");

    await tx.transactions.update({
      where: { id: transaction.id },
      data: {
        orderStatus: "FAILED",
      },
    });

    await restorePromotionUsage(tx, transaction);

    await tx.products.update({
      where: { id: transaction.productId ?? "0" },
      data: {
        stock: {
          increment: transaction.quantity,
        },
      },
    });

    if (transaction.flashSaleId) {
      await tx.flashSale.update({
        where: { id: transaction.flashSaleId },
        data: {
          stock: {
            increment: transaction.quantity,
          },
        },
      });
    }

    await refundToUserBalance({
      tx,
      userId: transaction.userId,
      amount: Number(transaction.totalPrice ?? 0),
      ref: transaction.trxId,
      paymentMethodCode: transaction.paymentMethod?.methodCode ?? null,
      paymentSource: transaction.paymentMethod?.source ?? null,
      meta: {
        transactionId: transaction.id,
        productId: transaction.productId,
      },
    });

    if (error?.provider || error?.statusCode) {
      await createSystemLog(fastify, {
        type: "third_party_error",
        source: "digiflazz.create_order",
        message:
          error?.data?.message ??
          error?.message ??
          "Gagal kirim order ke Digiflazz",
        statusCode: error?.statusCode ?? 502,
        trxId: transaction.trxId,
        provider: error?.provider ?? "digiflazz",
        requestPayload: error?.requestPayload ?? {
          skuCode: transaction.skuCode,
          customerNo: `${userData.primary_id ?? ""}${userData.server_id ?? ""}`,
          refId: transaction.trxId,
        },
        responsePayload: error?.responsePayload ?? error?.data ?? error ?? null,
        errorStack: error?.stack ?? null,
      });
    }

    return;
  }
}

function requireAdmin(req: any, reply: any) {
  if (!ensureAdmin(req.user)) {
    reply.status(403).send({ message: "Forbidden" });
    return false;
  }
  return true;
}

function normalizeTargetProductId(itemId: string, flashId?: number) {
  return flashId ? itemId : itemId;
}

async function findApplicablePromotion(
  fastify: FastInstance,
  params: {
    promoCode?: string;
    product: {
      id: string;
      categoryId?: string | null;
      subCategoryId?: string | null;
    };
    totalBeforePromo: number;
    userId?: string | null;
    flashSaleActive: boolean;
  },
) {
  const code = params.promoCode?.trim().toUpperCase();
  if (!code) return { promotion: null, reason: null };

  const promotion = await fastify.prisma.promotionsCode.findFirst({
    where: {
      code,
      active: true,
    },
  });

  if (!promotion) {
    return {
      promotion: null,
      reason: "Kode promo tidak ditemukan atau sudah nonaktif.",
    };
  }

  if (promotion.expiredDate && promotion.expiredDate.getTime() < Date.now()) {
    return {
      promotion: null,
      reason: "Kode promo sudah kadaluarsa.",
    };
  }

  if (promotion.maxUse > 0 && promotion.used >= promotion.maxUse) {
    return {
      promotion: null,
      reason: "Limit penggunaan kode promo sudah habis.",
    };
  }

  if (promotion.productId && promotion.productId !== params.product.id) {
    return {
      promotion: null,
      reason: "Kode promo ini hanya berlaku untuk produk tertentu.",
    };
  }

  if (
    promotion.categoryId &&
    promotion.categoryId !== params.product.categoryId
  ) {
    return {
      promotion: null,
      reason: "Kode promo ini hanya berlaku untuk kategori tertentu.",
    };
  }

  if (
    promotion.subCategoryId &&
    promotion.subCategoryId !== params.product.subCategoryId
  ) {
    return {
      promotion: null,
      reason: "Kode promo ini hanya berlaku untuk sub kategori tertentu.",
    };
  }

  if (promotion.userId && promotion.userId !== params.userId) {
    return {
      promotion: null,
      reason: "Kode promo ini hanya bisa dipakai oleh user tertentu.",
    };
  }

  const minTrx = Number(promotion.minTrx ?? 0);
  if (minTrx > 0 && params.totalBeforePromo < minTrx) {
    return {
      promotion: null,
      reason: `Minimal transaksi untuk promo ini adalah Rp ${minTrx.toLocaleString("id-ID")}.`,
    };
  }

  if (params.flashSaleActive && !promotion.allowFlashSale) {
    return {
      promotion: null,
      reason: "Kode promo ini tidak bisa dipakai bersamaan dengan flash sale.",
    };
  }

  return { promotion, reason: null };
}

async function restorePromotionUsage(
  tx: FastInstance["prisma"] | any,
  transaction: {
    id: string;
    paymentStatus: string;
    orderStatus: string;
    providerData?: any;
  },
) {
  const providerData =
    typeof transaction.providerData === "object" &&
    transaction.providerData !== null
      ? (transaction.providerData as Record<string, any>)
      : {};

  const promotionId = providerData.promotionId;
  const promotionUsageRestored = !!providerData.promotionUsageRestored;

  if (!promotionId || promotionUsageRestored) {
    return;
  }

  await tx.promotionsCode.update({
    where: { id: Number(promotionId) },
    data: {
      used: {
        decrement: 1,
      },
    },
  });

  await tx.transactions.update({
    where: { id: transaction.id },
    data: {
      providerData: {
        ...providerData,
        promotionUsageRestored: true,
        promotionUsageRestoredAt: new Date().toISOString(),
      },
    },
  });
}

export default async function (fastify: FastInstance) {
  fastify.post("/payments", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!requireAdmin(req, reply)) return;

      const parsed = paymentMethodCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Invalid payment method payload.",
          errors: parsed.error.flatten(),
        });
      }

      const body = parsed.data;
      const existPayment = await fastify.prisma.paymentMethod.findFirst({
        where: { methodCode: body.methodCode },
      });

      if (existPayment) {
        return reply.status(409).send({
          message: "Payment method already exists.",
        });
      }

      const payment = await fastify.prisma.paymentMethod.create({
        data: body as any,
      });

      await createActivityLog(fastify, {
        actorUserId: req.user?.id,
        actorName: req.user?.displayName ?? req.user?.email ?? null,
        actorRole: req.user?.role ?? null,
        action: "payment.create",
        entityType: "payment_method",
        entityId: String(payment.id),
        entityLabel: payment.paymentName,
        description: `Membuat payment method ${payment.paymentName}`,
        metadata: body,
      });

      return reply.status(201).send(payment);
    },
  });

  fastify.put("/payments/:id", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!requireAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const paymentId = Number(id);
      if (!Number.isInteger(paymentId) || paymentId <= 0) {
        return reply
          .status(400)
          .send({ message: "Invalid payment method id." });
      }

      const parsed = paymentMethodUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Invalid payment method update payload.",
          errors: parsed.error.flatten(),
        });
      }

      const body = parsed.data;
      const existing = await fastify.prisma.paymentMethod.findUnique({
        where: { id: paymentId },
      });

      if (!existing) {
        return reply.status(404).send({ message: "Payment method not found." });
      }

      if (body.methodCode && body.methodCode !== existing.methodCode) {
        const conflict = await fastify.prisma.paymentMethod.findFirst({
          where: { methodCode: body.methodCode },
        });

        if (conflict) {
          return reply
            .status(409)
            .send({ message: "methodCode already exists." });
        }
      }

      const updated = await fastify.prisma.paymentMethod.update({
        where: { id: paymentId },
        data: body as any,
      });

      await createActivityLog(fastify, {
        actorUserId: req.user?.id,
        actorName: req.user?.displayName ?? req.user?.email ?? null,
        actorRole: req.user?.role ?? null,
        action: "payment.update",
        entityType: "payment_method",
        entityId: String(updated.id),
        entityLabel: updated.paymentName,
        description: `Mengubah payment method ${updated.paymentName}`,
        metadata: {
          before: existing,
          after: updated,
        },
      });

      return reply.send({
        message: "Payment method updated successfully.",
        data: updated,
      });
    },
  });

  fastify.delete("/payments/:id", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!requireAdmin(req, reply)) return;

      const { id } = req.params as { id: string };
      const paymentId = Number(id);
      if (!Number.isInteger(paymentId) || paymentId <= 0) {
        return reply
          .status(400)
          .send({ message: "Invalid payment method id." });
      }

      const existing = await fastify.prisma.paymentMethod.findUnique({
        where: { id: paymentId },
        include: {
          transactions: {
            select: { id: true },
            take: 1,
          },
        },
      });

      if (!existing) {
        return reply.status(404).send({ message: "Payment method not found." });
      }

      if (existing.transactions.length > 0) {
        return reply.status(409).send({
          message:
            "Payment method is already used by transactions and cannot be deleted.",
        });
      }

      await fastify.prisma.paymentMethod.delete({ where: { id: paymentId } });

      await createActivityLog(fastify, {
        actorUserId: req.user?.id,
        actorName: req.user?.displayName ?? req.user?.email ?? null,
        actorRole: req.user?.role ?? null,
        action: "payment.delete",
        entityType: "payment_method",
        entityId: String(existing.id),
        entityLabel: existing.paymentName,
        description: `Menghapus payment method ${existing.paymentName}`,
        metadata: {
          methodCode: existing.methodCode,
          paymentVisibility: existing.paymentVisibility,
        },
      });

      return reply.send({ message: "Payment method deleted successfully." });
    },
  });

  fastify.get("/promotions/available", {
    preHandler: optionalAuthMiddleware,
    handler: async (req, reply) => {
      const {
        itemId,
        qty = "1",
        flashId,
      } = (req.query ?? {}) as Record<string, string | undefined>;

      if (!itemId) {
        return reply.status(400).send({ message: "itemId is required." });
      }

      const qtyNumber = Math.max(Number(qty) || 1, 1);
      const flashIdNumber = flashId ? Number(flashId) : undefined;

      let product = await fastify.prisma.products.findFirst({
        where: {
          id: itemId,
          status: { in: ["PUBLISHED", "AVAILABLE"] },
        },
      });

      if (flashId) {
        const productFlash = await fastify.prisma.flashSale.findFirst({
          where: { id: Number(flashId) },
          include: {
            products: true,
          },
        });
        product = productFlash?.products as any;
      }

      if (!product) {
        return reply.status(404).send({ message: "Product not found." });
      }

      const flashSale = await fastify.prisma.flashSale.findFirst({
        where: {
          productId: itemId,
          stock: { gte: qtyNumber },
          ...(flashIdNumber ? { id: flashIdNumber } : {}),
        },
      });

      const basePrice = Number(product.price);
      const flashDiscount = computeFlashDiscount(basePrice, flashSale).discount;
      const totalBeforePromo =
        Math.max(basePrice - flashDiscount, 0) * qtyNumber;

      const promotions = await fastify.prisma.promotionsCode.findMany({
        where: {
          active: true,
          OR: [{ expiredDate: null }, { expiredDate: { gte: new Date() } }],
        },
        orderBy: [{ createdAt: "desc" }],
      });

      const available = promotions.map((promotion) => {
        const { promotion: matchedPromotion, reason } = {
          ...{ promotion: null, reason: null },
          ...({} as any),
        };

        const isProductOk =
          !promotion.productId || promotion.productId === product.id;
        const isCategoryOk =
          !promotion.categoryId || promotion.categoryId === product.categoryId;
        const isSubCategoryOk =
          !promotion.subCategoryId ||
          promotion.subCategoryId === product.subCategoryId;
        const isUserOk = !promotion.userId || promotion.userId === req.user?.id;
        const isFlashOk = !flashSale || promotion.allowFlashSale;
        const minTrx = Number(promotion.minTrx ?? 0);
        const isMinTrxOk = minTrx <= 0 || totalBeforePromo >= minTrx;
        const remainingUse = Math.max(
          (promotion.maxUse ?? 0) - (promotion.used ?? 0),
          0,
        );
        const isRemainingOk = promotion.maxUse <= 0 || remainingUse > 0;

        const valid =
          isProductOk &&
          isCategoryOk &&
          isSubCategoryOk &&
          isUserOk &&
          isFlashOk &&
          isMinTrxOk &&
          isRemainingOk;

        let invalidReason: string | null = null;
        if (!isProductOk) invalidReason = "Hanya untuk produk tertentu.";
        else if (!isCategoryOk)
          invalidReason = "Hanya untuk kategori tertentu.";
        else if (!isSubCategoryOk)
          invalidReason = "Hanya untuk sub kategori tertentu.";
        else if (!isUserOk) invalidReason = "Hanya untuk user tertentu.";
        else if (!isFlashOk) invalidReason = "Tidak bisa digabung flash sale.";
        else if (!isMinTrxOk)
          invalidReason = `Minimal transaksi Rp ${minTrx.toLocaleString("id-ID")}.`;
        else if (!isRemainingOk) invalidReason = "Limit promo habis.";

        const promoDiscount = valid
          ? computePromoDiscount(basePrice, promotion as any)
          : 0;

        return {
          id: promotion.id,
          code: promotion.code,
          title: promotion.title,
          discType: promotion.discType,
          value: Number(promotion.value),
          minTrx: promotion.minTrx,
          maxDiscount: promotion.maxDiscount,
          valid,
          reason: invalidReason,
          allowFlashSale: promotion.allowFlashSale,
          target: {
            productId: promotion.productId,
            categoryId: promotion.categoryId,
            subCategoryId: promotion.subCategoryId,
            userId: promotion.userId,
          },
          previewDiscount: promoDiscount,
          remainingUse,
          expiredDate: promotion.expiredDate,
        };
      });

      return reply.send(serializeData(available));
    },
  });

  fastify.post("/payments/purchase/review", {
    preHandler: optionalAuthMiddleware,
    handler: async (req, reply) => {
      const parsed = paymentReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Invalid purchase review payload.",
          errors: parsed.error.flatten(),
        });
      }

      const { itemId, paymentMethod, qty, userData, flashId, promoCode } =
        parsed.data;

      const payment = await fastify.prisma.paymentMethod.findFirst({
        where: { id: paymentMethod, paymentVisibility: "active" },
      });

      const product = await fastify.prisma.products.findFirst({
        where: {
          id: itemId,
          status: { in: ["PUBLISHED", "AVAILABLE"] },
          stock: { gt: 0 },
        },
        include: {
          subCategory: {
            select: {
              slug: true,
            },
          },
        },
      });

      if (!payment) {
        return reply.status(404).send({ message: "Payment method not found" });
      }

      if (!product) {
        return reply
          .status(404)
          .send({ message: "Product not available or out of stock" });
      }

      const flashSale = await fastify.prisma.flashSale.findFirst({
        where: {
          productId: itemId,
          stock: { gte: qty },
          ...(flashId ? { id: flashId } : {}),
        },
      });

      if (flashSale && qty > 1) {
        return reply.status(400).send({
          message: "Produk flash sale hanya dapat dibeli 1 per transaksi",
        });
      }

      const basePrice = Number(product.price);
      const { discount: flashDiscount, discountLabel } = computeFlashDiscount(
        basePrice,
        flashSale,
      );
      const priceAfterFlash = Math.max(basePrice - flashDiscount, 0);
      const promotionCheck = await findApplicablePromotion(fastify, {
        promoCode,
        product,
        totalBeforePromo: priceAfterFlash * qty,
        userId: req.user?.id ?? null,
        flashSaleActive: !!flashSale,
      });

      if (promoCode && !promotionCheck.promotion) {
        return reply.status(400).send({
          message: promotionCheck.reason ?? "Kode promo tidak bisa dipakai.",
        });
      }

      const promoDiscount = promotionCheck.promotion
        ? computePromoDiscount(priceAfterFlash, promotionCheck.promotion as any)
        : 0;
      const discountedPrice = Math.max(priceAfterFlash - promoDiscount, 0);
      const fee = Math.round(computeFee(payment, discountedPrice, qty));
      const normalizedUserData = { ...userData } as Record<string, unknown>;

      try {
        if (userData.primary_id) {
          const result = await checkGameId({
            game: product.subCategory.slug as any,
            userId: userData.primary_id,
            zoneId: userData.server_id,
          });

          if (result.success) {
            normalizedUserData.username = result.username;
          }
        }
      } catch {}

      return reply.send({
        productName: product.title,
        productIcon: product.thumbnails,
        payment: payment.paymentName,
        paymentIcon: payment.thumbnail,
        price: basePrice,
        flashDiscount,
        discount: promoDiscount,
        discountLabel,
        discounted_price: discountedPrice,
        isFlashSale: !!flashSale,
        fee,
        total: discountedPrice * qty + fee,
        qty,
        userData: normalizedUserData,
        promotion: promotionCheck.promotion
          ? {
              id: promotionCheck.promotion.id,
              code: promotionCheck.promotion.code,
              title: promotionCheck.promotion.title,
              discType: promotionCheck.promotion.discType,
              value: Number(promotionCheck.promotion.value),
              discount: promoDiscount,
            }
          : null,
      });
    },
  });

  fastify.post("/payments/purchase", {
    preHandler: optionalAuthMiddleware,
    handler: async (req, reply) => {
      const parsed = paymentPurchaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Invalid purchase payload.",
          errors: parsed.error.flatten(),
        });
      }

      const {
        itemId,
        paymentMethod,
        qty,
        email,
        phoneNumber,
        userData,
        flashId,
        promoCode,
      } = parsed.data;

      const duitku = new DuitKu();
      const midtrans = new Midtrans();
      const merchantOrderId = `M-${Date.now().toString(36).toUpperCase()}${Math.random()
        .toString(36)
        .substring(2, 5)
        .toUpperCase()}`;

      const payment = await fastify.prisma.paymentMethod.findFirst({
        where: { id: paymentMethod, paymentVisibility: "active" },
      });

      const product = await fastify.prisma.products.findFirst({
        where: {
          id: itemId,
          status: { in: ["PUBLISHED", "AVAILABLE"] },
          stock: { gte: qty },
        },
        include: {
          subCategory: {
            select: {
              slug: true,
            },
          },
        },
      });

      if (!payment) {
        return reply.status(404).send({ message: "Payment method not found" });
      }

      if (!product) {
        return reply
          .status(404)
          .send({ message: "Product not available or out of stock" });
      }

      const flashSale = await fastify.prisma.flashSale.findFirst({
        where: {
          productId: itemId,
          stock: { gte: qty },
          ...(flashId ? { id: flashId } : {}),
        },
      });

      if (flashId && !flashSale) {
        return reply.status(404).send({
          message: "Flash sale tidak tersedia atau stok habis",
        });
      }

      if (flashSale && qty > 1) {
        return reply.status(400).send({
          message: "Produk flash sale hanya dapat dibeli 1 per transaksi",
        });
      }

      const basePrice = Number(product.price);
      const { discount: flashDiscount } = computeFlashDiscount(
        basePrice,
        flashSale,
      );
      const priceAfterFlash = Math.max(basePrice - flashDiscount, 0);
      const promotionCheck = await findApplicablePromotion(fastify, {
        promoCode,
        product,
        totalBeforePromo: priceAfterFlash * qty,
        userId: req.user?.id ?? null,
        flashSaleActive: !!flashSale,
      });

      if (promoCode && !promotionCheck.promotion) {
        return reply.status(400).send({
          message: promotionCheck.reason ?? "Kode promo tidak bisa dipakai.",
        });
      }

      const promoDiscount = promotionCheck.promotion
        ? computePromoDiscount(priceAfterFlash, promotionCheck.promotion as any)
        : 0;
      const discountedPrice = Math.max(priceAfterFlash - promoDiscount, 0);
      const fee = Math.round(computeFee(payment, discountedPrice, qty));
      const totalPrice = Math.round(discountedPrice * qty + fee);

      if (payment.minAmount && totalPrice < payment.minAmount) {
        return reply.status(400).send({
          message: `Minimal transaksi ${payment.paymentName} adalah Rp ${Number(payment.minAmount).toLocaleString("id-ID")}.`,
        });
      }

      if (payment.maxAmount && totalPrice > payment.maxAmount) {
        return reply.status(400).send({
          message: `Maksimal transaksi ${payment.paymentName} adalah Rp ${Number(payment.maxAmount).toLocaleString("id-ID")}.`,
        });
      }

      const duitkuCallbackUrl = process.env.DUITKU_CALLBACK_URL;
      const duitkuReturnUrl = process.env.DUITKU_RETURN_URL;
      const midtransFinishUrl = process.env.MIDTRANS_FINISH_URL;

      const normalizedUserData = { ...userData } as Record<string, unknown>;
      try {
        if (userData.primary_id) {
          const result = await checkGameId({
            game: product.subCategory.slug as any,
            userId: userData.primary_id,
            zoneId: userData.server_id,
          });

          if (result.success) {
            normalizedUserData.username = result.username;
          }
        }
      } catch {}

      let requestPayment: any;
      try {
        if (payment.source === "BALANCE") {
          if (!req.user?.id) {
            return reply.status(401).send({
              message: "Silakan login terlebih dahulu untuk menggunakan saldo.",
            });
          }

          requestPayment = {
            source: "BALANCE",
            methodCode: payment.methodCode,
            paymentName: payment.paymentName,
            amount: totalPrice,
            status: "PAID",
          };
        } else if (payment.source === "DUITKU") {
          if (!duitkuCallbackUrl || !duitkuReturnUrl) {
            return reply.status(500).send({
              message:
                "DUITKU_CALLBACK_URL and DUITKU_RETURN_URL must be configured.",
            });
          }

          requestPayment = await duitku.createPayment({
            amount: totalPrice,
            itemName: product.title,
            quantity: qty,
            merchantOrderId,
            paymentMethod: payment.methodCode,
            email,
            phoneNumber,
            callbackUrl: duitkuCallbackUrl,
            returnUrl: duitkuReturnUrl,
          });
        } else if (payment.source === "MIDTRANS") {
          requestPayment = await midtrans.createPayment(
            {
              orderId: merchantOrderId,
              amount: totalPrice,
              itemName: product.title,
              quantity: qty,
              paymentMethod: payment.methodCode,
              email,
              phoneNumber,
              finishUrl: midtransFinishUrl,
            },
            process.env.MIDTRANS_IS_PRODUCTION === "true",
          );
        } else {
          return reply.status(400).send({
            message: `Payment source ${payment.source} belum didukung.`,
          });
        }
      } catch (error: any) {
        req.log.error(
          {
            error,
            paymentMethod: payment.methodCode,
            paymentSource: payment.source,
            merchantOrderId,
          },
          "Failed to create payment",
        );

        const message =
          error?.Message ??
          error?.message ??
          error?.data?.message ??
          error?.responseMessage ??
          "Gagal membuat pembayaran ke gateway.";

        if (error?.provider || error?.statusCode) {
          await createSystemLog(fastify, {
            type: "third_party_error",
            source:
              payment.source === "MIDTRANS"
                ? "midtrans.create_payment"
                : "duitku.create_payment",
            message,
            statusCode: error?.statusCode ?? 502,
            method: req.method,
            url: req.url,
            trxId: merchantOrderId,
            provider:
              error?.provider ??
              (payment.source === "MIDTRANS" ? "midtrans" : "duitku"),
            requestPayload: error?.requestPayload ?? {
              amount: totalPrice,
              itemName: product.title,
              quantity: qty,
              merchantOrderId,
              paymentMethod: payment.methodCode,
              paymentSource: payment.source,
              email,
              phoneNumber,
            },
            responsePayload:
              error?.responsePayload ?? error?.data ?? error ?? null,
            errorStack: error?.stack ?? null,
          });
        }

        return reply.status(502).send({
          message,
          data: error,
        });
      }

      let transaction;
      try {
        transaction = await fastify.prisma.$transaction(async (tx) => {
          if (promotionCheck.promotion) {
            await tx.promotionsCode.update({
              where: { id: promotionCheck.promotion.id },
              data: {
                used: {
                  increment: 1,
                },
              },
            });
          }

          if (payment.source === "BALANCE") {
            const balanceType = payment.methodCode
              .toLowerCase()
              .includes("point")
              ? "POINTS"
              : "WALLET";

            const userBalance = await tx.userBalance.findUnique({
              where: {
                userId_type: {
                  userId: req.user!.id,
                  type: balanceType,
                },
              },
            });

            const currentAmount = Number(userBalance?.amount ?? 0);
            if (currentAmount < totalPrice) {
              throw Object.assign(
                new Error(
                  balanceType === "POINTS"
                    ? `T-Points kamu tidak cukup. Butuh ${totalPrice.toLocaleString("id-ID")}, tersedia ${currentAmount.toLocaleString("id-ID")}.`
                    : `Saldo T-Gems kamu tidak cukup. Butuh Rp ${totalPrice.toLocaleString("id-ID")}, tersedia Rp ${currentAmount.toLocaleString("id-ID")}.`,
                ),
                { statusCode: 400 },
              );
            }

            await tx.userBalance.upsert({
              where: {
                userId_type: {
                  userId: req.user!.id,
                  type: balanceType,
                },
              },
              update: {
                amount: {
                  decrement: totalPrice,
                },
              },
              create: {
                userId: req.user!.id,
                type: balanceType,
                amount: 0,
              },
            });

            const paymentMeta = {
              trxId: merchantOrderId,
              paymentMethodId: paymentMethod,
              paymentMethodName: payment.paymentName,
              productId: product.id,
              productName: product.title,
              totalPrice,
              qty,
            };

            if (balanceType === "POINTS") {
              await tx.pointEntry.create({
                data: {
                  userId: req.user!.id,
                  amount: -totalPrice,
                  ref: merchantOrderId,
                  meta: paymentMeta as any,
                },
              });
            } else {
              await tx.moneyEntry.create({
                data: {
                  userId: req.user!.id,
                  amount: BigInt(-totalPrice),
                  ref: merchantOrderId,
                  meta: paymentMeta as any,
                },
              });
            }
          }

          const trx = await tx.transactions.create({
            data: {
              fee,
              paymentMethodId: paymentMethod,
              userAccountData: normalizedUserData as any,
              trxId: merchantOrderId,
              price: product.price,
              discount: promoDiscount + flashDiscount,
              discountedPrice,
              totalPrice,
              orderStatus:
                payment.source === "BALANCE" ? "PENDING" : "WAIT_PAYMENT",
              paymentStatus:
                payment.source === "BALANCE" ? "SUCCESS" : "PENDING",
              email,
              phoneNumber,
              quantity: qty,
              paymentDetails: requestPayment,
              productId: itemId,
              flashSaleId: flashSale?.id ?? null,
              skuCode: product.skuCode,
              userId: req.user?.id,
              successAt: payment.source === "BALANCE" ? new Date() : null,
              providerData: {
                promotionId: promotionCheck.promotion?.id ?? null,
                promotionCode: promotionCheck.promotion?.code ?? null,
                promotionDiscount: promoDiscount,
                flashDiscount,
                promotionUsageRestored: false,
                balancePayment: payment.source === "BALANCE",
              } as any,
            },
          });

          await tx.products.update({
            data: { stock: { decrement: qty } },
            where: { id: product.id },
          });

          if (flashSale?.id) {
            await tx.flashSale.update({
              where: { id: flashSale.id },
              data: { stock: { decrement: qty } },
            });
          }

          if (payment.source === "BALANCE") {
            await processSuccessfulOrder({
              fastify,
              tx,
              transaction: {
                ...trx,
                product: {
                  provider: product.provider,
                },
                paymentMethod: {
                  methodCode: payment.methodCode,
                  source: payment.source,
                },
              },
            });
          }

          return trx;
        });
      } catch (error: any) {
        return reply.status(error?.statusCode ?? 500).send({
          message: error?.message ?? "Gagal memproses transaksi balance.",
        });
      }

      const trxResult = await fastify.prisma.transactions.findFirst({
        where: { id: transaction.id },
        include: { product: true },
      });

      return reply.status(201).send(convertBigIntAndDate(trxResult));
    },
  });

  fastify.post("/payments/prices", {
    handler: async (req, reply) => {
      const parsed = paymentPricesSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Invalid prices payload.",
          errors: parsed.error.flatten(),
        });
      }

      const { itemId, qty, flashId, promoCode } = parsed.data;

      const product = await fastify.prisma.products.findFirst({
        where: { id: itemId },
      });

      if (!product) {
        return reply
          .status(404)
          .send({ message: "Product not found or deleted." });
      }

      const flashSale = await fastify.prisma.flashSale.findFirst({
        where: {
          productId: itemId,
          stock: { gte: qty },
          ...(flashId ? { id: flashId } : {}),
        },
      });

      if (flashSale && qty > 1) {
        return reply.status(400).send({
          message: "Produk flash sale hanya dapat dibeli 1 per transaksi",
        });
      }

      const basePrice = Number(product.price);
      const { discount: flashDiscount } = computeFlashDiscount(
        basePrice,
        flashSale,
      );
      const priceAfterFlash = Math.max(basePrice - flashDiscount, 0);
      const promotionCheck = await findApplicablePromotion(fastify, {
        promoCode,
        product,
        totalBeforePromo: priceAfterFlash * qty,
        userId: req.user?.id ?? null,
        flashSaleActive: !!flashSale,
      });

      const promoDiscount = promotionCheck.promotion
        ? computePromoDiscount(priceAfterFlash, promotionCheck.promotion as any)
        : 0;
      const discountedPrice = Math.max(priceAfterFlash - promoDiscount, 0);

      const payments = await fastify.prisma.paymentMethod.findMany({
        where: { paymentVisibility: "active" },
        select: {
          id: true,
          paymentName: true,
          feeType: true,
          feeValue: true,
          minAmount: true,
          maxAmount: true,
        },
      });

      const prices = payments.map((pay) => {
        const fee = Math.round(computeFee(pay, discountedPrice, qty));
        const totalPrice = Math.round(discountedPrice * qty + fee);

        let valid = true;
        let reason: string | null = null;

        if (pay.minAmount && totalPrice < pay.minAmount) {
          valid = false;
          reason = `Minimal transaksi ${pay.paymentName} adalah Rp ${pay.minAmount.toLocaleString("id-ID")}`;
        } else if (pay.maxAmount && totalPrice > pay.maxAmount) {
          valid = false;
          reason = `Maksimal transaksi ${pay.paymentName} adalah Rp ${pay.maxAmount.toLocaleString("id-ID")}`;
        }

        return {
          id: pay.id,
          price: basePrice,
          flash_discount: flashDiscount,
          promo_discount: promoDiscount,
          discount: flashDiscount + promoDiscount,
          discounted_price: discountedPrice,
          fee,
          total_price: totalPrice,
          qty,
          valid,
          reason,
          min_amount: pay.minAmount,
          max_amount: pay.maxAmount,
        };
      });

      return reply.send(prices);
    },
  });

  fastify.get("/payments/available", {
    preHandler: optionalAuthMiddleware,
    handler: async (req, reply) => {
      const isAdmin = req.user?.role === "admin";

      // Admin dapat data lebih lengkap, pisahkan cache key-nya
      const cacheKey = isAdmin
        ? "payments:available:admin"
        : "payments:available:public";

      const cached = await fastify.cache.get<any[]>(cacheKey);
      if (cached) return reply.send(cached);

      const payments = await fastify.prisma.paymentMethod.findMany({
        where: isAdmin ? undefined : { paymentVisibility: "active" },
        select: {
          id: true,
          paymentName: true,
          thumbnail: true,
          group: true,
          paymentVisibility: true,
          feeType: isAdmin,
          feeValue: isAdmin,
          methodCode: isAdmin,
          source: isAdmin,
        },
      });

      // TTL 10 menit — payment method jarang berubah
      await fastify.cache.set(cacheKey, payments, 600);

      return reply.send(payments);
    },
  });
}

export { restorePromotionUsage, findApplicablePromotion, computePromoDiscount };
