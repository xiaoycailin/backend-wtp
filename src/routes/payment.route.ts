import { DuitKu } from "../utils/payment";
import { FastInstance } from "../utils/fastify";
import {
  authMiddleware,
  optionalAuthMiddleware,
} from "../plugins/authMiddleware";
import { convertBigIntAndDate } from "./products.route";
import { checkGameId } from "utils/gameIdChecker";
import { ensureAdmin } from "../utils/auth";
import {
  paymentMethodCreateSchema,
  paymentMethodUpdateSchema,
  paymentPricesSchema,
  paymentPurchaseSchema,
  paymentReviewSchema,
} from "../schemas/payment.schema";

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

function requireAdmin(req: any, reply: any) {
  if (!ensureAdmin(req.user)) {
    reply.status(403).send({ message: "Forbidden" });
    return false;
  }
  return true;
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
      return reply.send({ message: "Payment method deleted successfully." });
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

      const { itemId, paymentMethod, qty, userData, flashId } = parsed.data;

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
          ...(flashId ? { id: flashId } : {}),
        },
      });

      if (flashSale && qty > 1) {
        return reply.status(400).send({
          message: "Produk flash sale hanya dapat dibeli 1 per transaksi",
        });
      }

      const basePrice = Number(product.price);
      const { discount, discountLabel } = computeFlashDiscount(
        basePrice,
        flashSale,
      );
      const discountedPrice = Math.max(basePrice - discount, 0);
      const fee = computeFee(payment, discountedPrice, qty);
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
        discount,
        discountLabel,
        discounted_price: discountedPrice,
        isFlashSale: !!flashSale,
        fee,
        total: discountedPrice * qty + fee,
        qty,
        userData: normalizedUserData,
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
      } = parsed.data;

      const duitku = new DuitKu();
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
          ...(flashId ? { id: flashId } : {}),
        },
      });

      if (flashSale && qty > 1) {
        return reply.status(400).send({
          message: "Produk flash sale hanya dapat dibeli 1 per transaksi",
        });
      }

      const basePrice = Number(product.price);
      const { discount } = computeFlashDiscount(basePrice, flashSale);
      const discountedPrice = Math.max(basePrice - discount, 0);
      const fee = computeFee(payment, discountedPrice, qty);
      const totalPrice = discountedPrice * qty + fee;

      const callbackUrl = process.env.DUITKU_CALLBACK_URL;
      const returnUrl = process.env.DUITKU_RETURN_URL;
      if (!callbackUrl || !returnUrl) {
        return reply.status(500).send({
          message:
            "DUITKU_CALLBACK_URL and DUITKU_RETURN_URL must be configured.",
        });
      }

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

      const requestPayment = await duitku.createPayment({
        amount: totalPrice,
        itemName: product.title,
        quantity: qty,
        merchantOrderId,
        paymentMethod: payment.methodCode,
        email,
        phoneNumber,
        callbackUrl,
        returnUrl,
      });

      const transaction = await fastify.prisma.$transaction(async (tx) => {
        const trx = await tx.transactions.create({
          data: {
            fee,
            paymentMethodId: paymentMethod,
            userAccountData: normalizedUserData as any,
            trxId: merchantOrderId,
            price: product.price,
            discount,
            discountedPrice,
            totalPrice,
            orderStatus: "WAIT_PAYMENT",
            paymentStatus: "PENDING",
            email,
            phoneNumber,
            quantity: qty,
            paymentDetails: requestPayment,
            productId: itemId,
            flashSaleId: flashSale?.id ?? null,
            skuCode: product.skuCode,
            userId: req.user?.id,
          },
        });

        await tx.products.update({
          data: { stock: { decrement: qty } },
          where: { id: product.id },
        });

        return trx;
      });

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

      const { itemId, qty, flashId } = parsed.data;

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
          ...(flashId ? { id: flashId } : {}),
        },
      });

      if (flashSale && qty > 1) {
        return reply.status(400).send({
          message: "Produk flash sale hanya dapat dibeli 1 per transaksi",
        });
      }

      const basePrice = Number(product.price);
      const { discount } = computeFlashDiscount(basePrice, flashSale);
      const discountedPrice = Math.max(basePrice - discount, 0);

      const payments = await fastify.prisma.paymentMethod.findMany({
        where: { paymentVisibility: "active" },
        select: {
          id: true,
          paymentName: true,
          feeType: true,
          feeValue: true,
        },
      });

      const prices = payments.map((pay) => {
        const fee = computeFee(pay, discountedPrice, qty);
        return {
          id: pay.id,
          price: basePrice,
          discount,
          discounted_price: discountedPrice,
          fee,
          total_price: discountedPrice * qty + fee,
          qty,
        };
      });

      return reply.send(prices);
    },
  });

  fastify.get("/payments/available", {
    preHandler: optionalAuthMiddleware,
    handler: async (req, reply) => {
      const isAdmin = req.user?.role === "admin";

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

      return reply.send(payments);
    },
  });
}
