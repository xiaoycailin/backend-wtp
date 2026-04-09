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
        sumTotalPricePaymentSuccess,
        sumFeePaymentSuccess,
        sumTotalPriceFullySuccess,
        sumFeeFullySuccess,
        sumTotalPriceOrderFailed,
        sumFeeOrderFailed,
        perPaymentStatus,
        perOrderStatus,
        perPaymentMethodAll,
        perPaymentMethodSuccess,
        perPaymentMethodFullySuccess,
        trxWithSubAll,
        trxWithSubPaymentSuccess,
        trxWithSubFullySuccess,
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
        fastify.prisma.transactions.aggregate({ where: { ...baseWhere, paymentStatus: "SUCCESS" }, _sum: { totalPrice: true } }),
        fastify.prisma.transactions.aggregate({ where: { ...baseWhere, paymentStatus: "SUCCESS" }, _sum: { fee: true } }),
        fastify.prisma.transactions.aggregate({ where: { ...baseWhere, paymentStatus: "SUCCESS", orderStatus: "SUCCESS" }, _sum: { totalPrice: true } }),
        fastify.prisma.transactions.aggregate({ where: { ...baseWhere, paymentStatus: "SUCCESS", orderStatus: "SUCCESS" }, _sum: { fee: true } }),
        fastify.prisma.transactions.aggregate({ where: { ...baseWhere, orderStatus: "FAILED" }, _sum: { totalPrice: true } }),
        fastify.prisma.transactions.aggregate({ where: { ...baseWhere, orderStatus: "FAILED" }, _sum: { fee: true } }),
        fastify.prisma.transactions.groupBy({ by: ["paymentStatus"], where: baseWhere, _count: { _all: true } }),
        fastify.prisma.transactions.groupBy({ by: ["orderStatus"], where: baseWhere, _count: { _all: true } }),
        fastify.prisma.transactions.groupBy({ by: ["paymentMethodId"], where: baseWhere, _sum: { totalPrice: true }, _count: { _all: true } }),
        fastify.prisma.transactions.groupBy({ by: ["paymentMethodId"], where: { ...baseWhere, paymentStatus: "SUCCESS" }, _sum: { totalPrice: true }, _count: { _all: true } }),
        fastify.prisma.transactions.groupBy({ by: ["paymentMethodId"], where: { ...baseWhere, paymentStatus: "SUCCESS", orderStatus: "SUCCESS" }, _sum: { totalPrice: true }, _count: { _all: true } }),
        fastify.prisma.transactions.findMany({
          where: baseWhere,
          include: {
            product: {
              select: {
                id: true,
                title: true,
                subCategoryId: true,
                subCategory: {
                  select: {
                    id: true,
                    title: true,
                    categoryId: true,
                    category: {
                      select: {
                        id: true,
                        title: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        fastify.prisma.transactions.findMany({
          where: { ...baseWhere, paymentStatus: "SUCCESS" },
          include: {
            product: {
              select: {
                id: true,
                title: true,
                subCategoryId: true,
                subCategory: {
                  select: {
                    id: true,
                    title: true,
                    categoryId: true,
                    category: {
                      select: {
                        id: true,
                        title: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        fastify.prisma.transactions.findMany({
          where: { ...baseWhere, paymentStatus: "SUCCESS", orderStatus: "SUCCESS" },
          include: {
            product: {
              select: {
                id: true,
                title: true,
                subCategoryId: true,
                subCategory: {
                  select: {
                    id: true,
                    title: true,
                    categoryId: true,
                    category: {
                      select: {
                        id: true,
                        title: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      ]);

      const pmIds = Array.from(
        new Set(
          [
            ...perPaymentMethodAll,
            ...perPaymentMethodSuccess,
            ...perPaymentMethodFullySuccess,
          ]
            .map((p) => p.paymentMethodId)
            .filter((id) => id !== null),
        ),
      ) as number[];

      const paymentMethods =
        pmIds.length > 0
          ? await fastify.prisma.paymentMethod.findMany({
              where: { id: { in: pmIds } },
              select: {
                id: true,
                paymentName: true,
                methodCode: true,
                group: true,
                thumbnail: true,
              },
            })
          : [];

      const mapPMAll = new Map<number, { count: number; sum: number }>();
      perPaymentMethodAll.forEach((row) => {
        if (row.paymentMethodId == null) return;
        mapPMAll.set(row.paymentMethodId, {
          count: row._count._all,
          sum: toNumber(row._sum.totalPrice),
        });
      });

      const mapPMSuccess = new Map<number, { count: number; sum: number }>();
      perPaymentMethodSuccess.forEach((row) => {
        if (row.paymentMethodId == null) return;
        mapPMSuccess.set(row.paymentMethodId, {
          count: row._count._all,
          sum: toNumber(row._sum.totalPrice),
        });
      });

      const mapPMFully = new Map<number, { count: number; sum: number }>();
      perPaymentMethodFullySuccess.forEach((row) => {
        if (row.paymentMethodId == null) return;
        mapPMFully.set(row.paymentMethodId, {
          count: row._count._all,
          sum: toNumber(row._sum.totalPrice),
        });
      });

      const perPaymentMethod = pmIds.map((id) => {
        const pm = paymentMethods.find((p) => p.id === id);
        const all = mapPMAll.get(id) ?? { count: 0, sum: 0 };
        const suc = mapPMSuccess.get(id) ?? { count: 0, sum: 0 };
        const full = mapPMFully.get(id) ?? { count: 0, sum: 0 };

        return {
          paymentMethodId: id,
          paymentName: pm?.paymentName ?? "Unknown",
          methodCode: pm?.methodCode ?? null,
          group: pm?.group ?? null,
          thumbnail: pm?.thumbnail ?? null,
          countAll: all.count,
          sumAll: all.sum,
          countPaymentSuccess: suc.count,
          sumPaymentSuccess: suc.sum,
          countFullySuccess: full.count,
          sumFullySuccess: full.sum,
        };
      });

      type TrxRow = (typeof trxWithSubAll)[number];
      type SubAgg = {
        subCategoryId: string;
        subCategoryTitle: string;
        categoryId: string | null;
        categoryTitle: string | null;
        totalTransactionsAll: number;
        totalQtyAll: number;
        sumAll: number;
        totalTransactionsPaymentSuccess: number;
        sumPaymentSuccess: number;
        totalTransactionsFullySuccess: number;
        sumFullySuccess: number;
      };

      function aggregateSubCategory(
        target: Map<string, SubAgg>,
        list: TrxRow[],
        kind: "all" | "paySuccess" | "fully",
      ) {
        for (const t of list) {
          if (!t.product || !t.product.subCategory) continue;
          const sub = t.product.subCategory;
          const key = sub.id;

          if (!target.has(key)) {
            target.set(key, {
              subCategoryId: sub.id,
              subCategoryTitle: sub.title,
              categoryId: sub.category?.id ?? null,
              categoryTitle: sub.category?.title ?? null,
              totalTransactionsAll: 0,
              totalQtyAll: 0,
              sumAll: 0,
              totalTransactionsPaymentSuccess: 0,
              sumPaymentSuccess: 0,
              totalTransactionsFullySuccess: 0,
              sumFullySuccess: 0,
            });
          }

          const agg = target.get(key)!;

          if (kind === "all") {
            agg.totalTransactionsAll += 1;
            agg.totalQtyAll += t.quantity ?? 0;
            agg.sumAll += toNumber(t.totalPrice);
          } else if (kind === "paySuccess") {
            agg.totalTransactionsPaymentSuccess += 1;
            agg.sumPaymentSuccess += toNumber(t.totalPrice);
          } else {
            agg.totalTransactionsFullySuccess += 1;
            agg.sumFullySuccess += toNumber(t.totalPrice);
          }
        }
      }

      const subMap = new Map<string, SubAgg>();
      aggregateSubCategory(subMap, trxWithSubAll as any, "all");
      aggregateSubCategory(subMap, trxWithSubPaymentSuccess as any, "paySuccess");
      aggregateSubCategory(subMap, trxWithSubFullySuccess as any, "fully");

      const perSubCategory = Array.from(subMap.values()).sort(
        (a, b) => b.sumAll - a.sumAll,
      );

      return reply.send(serializeData({
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
        sumDiscount: toNumber(sumDiscount._sum.discount),
        sumFee: toNumber(sumFee._sum.fee),
        grossFromPaymentSuccess: toNumber(sumTotalPricePaymentSuccess._sum.totalPrice),
        netFromPaymentSuccess:
          toNumber(sumTotalPricePaymentSuccess._sum.totalPrice) -
          toNumber(sumFeePaymentSuccess._sum.fee),
        grossFullySuccess: toNumber(sumTotalPriceFullySuccess._sum.totalPrice),
        netFullySuccess:
          toNumber(sumTotalPriceFullySuccess._sum.totalPrice) -
          toNumber(sumFeeFullySuccess._sum.fee),
        grossOrderFailed: toNumber(sumTotalPriceOrderFailed._sum.totalPrice),
        netOrderFailed:
          toNumber(sumTotalPriceOrderFailed._sum.totalPrice) -
          toNumber(sumFeeOrderFailed._sum.fee),
        perPaymentStatus: perPaymentStatus.map((row) => ({
          paymentStatus: row.paymentStatus,
          count: row._count._all,
        })),
        perOrderStatus: perOrderStatus.map((row) => ({
          orderStatus: row.orderStatus,
          count: row._count._all,
        })),
        perPaymentMethod,
        perSubCategory,
      }));
    },
  });
}
