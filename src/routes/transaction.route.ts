import { FastInstance } from "../utils/fastify";
import { authMiddleware } from "../plugins/authMiddleware";
import { Prisma } from "@prisma/client";
import { serializeData } from "../utils/json";
import { ensureAdmin } from "../utils/auth";

function toNumber(value: unknown) {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

function buildTransactionSearch(search?: string): Prisma.TransactionsWhereInput["OR"] {
  if (!search?.trim()) {
    return undefined;
  }

  const s = search.trim();
  return [
    { userAccountData: { string_contains: s } },
    { userInputDetail: { string_contains: s } },
    { phoneNumber: { contains: s } },
    { email: { contains: s } },
    {
      product: {
        title: { contains: s },
        description: { contains: s },
      },
    },
  ];
}

export default async function (fastify: FastInstance) {
  fastify.get("/transactions/history/:trxId", {
    handler: async (req, reply) => {
      const { trxId } = req.params as { trxId: string };
      if (!trxId) {
        return reply.status(400).send({ message: "trxId is required." });
      }

      const transaction = await fastify.prisma.transactions.findFirst({
        where: { trxId },
        include: {
          product: true,
          paymentMethod: {
            select: {
              paymentName: true,
              group: true,
              thumbnail: true,
            },
          },
        },
      });

      if (!transaction) {
        return reply.status(404).send({ message: "Transaction not found" });
      }

      return reply.send(serializeData(transaction));
    },
  });

  fastify.get("/transactions/c/:trxId", {
    handler: async (req, reply) => {
      const { trxId } = req.params as { trxId: string };
      if (!trxId) {
        return reply.status(400).send({ message: "trxId is required." });
      }

      const count = await fastify.prisma.transactions.count({ where: { trxId } });
      if (count === 0) {
        return reply.status(404).send({ message: "Transaction not found" });
      }

      return reply.send({ count });
    },
  });

  fastify.get("/transactions/history", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const {
        trxId,
        paymentStatus,
        orderStatus,
        userId,
        createdAtSort,
        search,
        page = "1",
        limit = "20",
      } = req.query as Record<string, string | undefined>;

      const pageNum = Math.max(parseInt(page, 10) || 1, 1);
      const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
      const skip = (pageNum - 1) * limitNum;

      const where: Prisma.TransactionsWhereInput = {
        ...(trxId ? { trxId } : {}),
        ...(paymentStatus ? { paymentStatus: paymentStatus as any } : {}),
        ...(orderStatus ? { orderStatus: orderStatus as any } : {}),
        ...(userId ? { userId } : {}),
      };

      const orSearch = buildTransactionSearch(search);
      if (orSearch) {
        where.OR = orSearch;
      }

      if (!ensureAdmin(req.user)) {
        where.userId = req.user?.id;
      }

      const [total, data] = await Promise.all([
        fastify.prisma.transactions.count({ where }),
        fastify.prisma.transactions.findMany({
          where,
          orderBy: { createdAt: createdAtSort === "asc" ? "asc" : "desc" },
          skip,
          take: limitNum,
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
              },
            },
            product: {
              select: {
                id: true,
                title: true,
                thumbnails: true,
              },
            },
            paymentMethod: true,
          },
        }),
      ]);

      return reply.send(
        serializeData({
          items: data,
          meta: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum) || 1,
          },
        }),
      );
    },
  });

  fastify.get("/transactions/summary", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user)) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      const { from, to } = req.query as { from?: string; to?: string };
      const baseWhere: Prisma.TransactionsWhereInput = {};

      if (from || to) {
        baseWhere.createdAt = {};
        if (from) baseWhere.createdAt.gte = new Date(from);
        if (to) baseWhere.createdAt.lte = new Date(to);
      }

      const [
        totalCount,
        totalPaymentSuccessCount,
        totalPaymentFailedCount,
        totalPaymentPendingCount,
        totalOrderSuccessCount,
        totalOrderFailedCount,
        totalOrderPendingCount,
        totalOrderWaitPaymentCount,
        sumPrice,
        sumTotalPrice,
        sumDiscount,
        sumFee,
      ] = await Promise.all([
        fastify.prisma.transactions.count({ where: baseWhere }),
        fastify.prisma.transactions.count({ where: { ...baseWhere, paymentStatus: "SUCCESS" } }),
        fastify.prisma.transactions.count({ where: { ...baseWhere, paymentStatus: "FAILED" } }),
        fastify.prisma.transactions.count({ where: { ...baseWhere, paymentStatus: "PENDING" } }),
        fastify.prisma.transactions.count({ where: { ...baseWhere, orderStatus: "SUCCESS" } }),
        fastify.prisma.transactions.count({ where: { ...baseWhere, orderStatus: "FAILED" } }),
        fastify.prisma.transactions.count({ where: { ...baseWhere, orderStatus: "PENDING" } }),
        fastify.prisma.transactions.count({ where: { ...baseWhere, orderStatus: "WAIT_PAYMENT" } }),
        fastify.prisma.transactions.aggregate({ where: baseWhere, _sum: { price: true } }),
        fastify.prisma.transactions.aggregate({ where: baseWhere, _sum: { totalPrice: true } }),
        fastify.prisma.transactions.aggregate({ where: baseWhere, _sum: { discount: true } }),
        fastify.prisma.transactions.aggregate({ where: baseWhere, _sum: { fee: true } }),
      ]);

      return reply.send({
        totalCount,
        totalPaymentSuccessCount,
        totalPaymentFailedCount,
        totalPaymentPendingCount,
        totalOrderSuccessCount,
        totalOrderFailedCount,
        totalOrderPendingCount,
        totalOrderWaitPaymentCount,
        sumPrice: toNumber(sumPrice._sum.price),
        sumTotalPrice: toNumber(sumTotalPrice._sum.totalPrice),
        sumDiscount: sumDiscount._sum.discount ?? 0,
        sumFee: sumFee._sum.fee ?? 0,
      });
    },
  });
}
