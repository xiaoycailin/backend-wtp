import { FastInstance } from "../utils/fastify";
import { authMiddleware } from "../plugins/authMiddleware";
import { Prisma } from "@prisma/client";
import { serializeData } from "../utils/json";
import { ensureAdmin } from "../utils/auth";
import DigiflazzClient from "../plugins/digiflazz-api";
import { createActivityLog } from "../utils/activity-log";

const allowedPaymentStatuses = ["PENDING", "SUCCESS", "FAILED", "REFUND"] as const;
const allowedOrderStatuses = ["WAIT_PAYMENT", "PENDING", "SUCCESS", "FAILED"] as const;

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

  fastify.patch("/transactions/:trxId/admin-action", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user)) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      const { trxId } = req.params as { trxId: string };
      const {
        paymentStatus,
        orderStatus,
        action,
      } = req.body as {
        paymentStatus?: string;
        orderStatus?: string;
        action?: string;
      };

      if (!trxId) {
        return reply.status(400).send({ message: "trxId is required." });
      }

      const existing = await fastify.prisma.transactions.findFirst({ where: { trxId } });
      if (!existing) {
        return reply.status(404).send({ message: "Transaction not found" });
      }

      if (action === "retry_order") {
        if (existing.paymentStatus !== "SUCCESS") {
          return reply.status(400).send({ message: "Retry order hanya bisa untuk transaksi dengan payment SUCCESS" });
        }

        if (!existing.skuCode) {
          return reply.status(400).send({ message: "Retry order gagal, skuCode transaksi tidak ada" });
        }

        const userData = (existing.userAccountData ?? {}) as Record<string, any>;
        const customerNo = `${userData.primary_id ?? ""}${userData.server_id ?? ""}`.trim();

        if (!customerNo) {
          return reply.status(400).send({ message: "Retry order gagal, data user tujuan tidak lengkap" });
        }

        const currentProviderData =
          typeof existing.providerData === "object" && existing.providerData !== null
            ? (existing.providerData as Record<string, any>)
            : {};
        const retryHistory = Array.isArray(currentProviderData.retryHistory)
          ? [...currentProviderData.retryHistory]
          : [];
        const previousRetryCount = Number(currentProviderData.retryCount ?? retryHistory.length ?? 0);
        const nextRetryCount = previousRetryCount + 1;
        const retryRefId = `${existing.trxId}-R${nextRetryCount}`;

        const df = new DigiflazzClient();

        try {
          const requestTrx = await df.prepaid.topup(existing.skuCode, customerNo, retryRefId);
          const dfData = requestTrx?.data;
          const digiflazzStatus = String(dfData?.status ?? "").toLowerCase();

          const retried = await fastify.prisma.transactions.update({
            where: { id: existing.id },
            data: {
              orderStatus:
                digiflazzStatus === "sukses"
                  ? ("SUCCESS" as any)
                  : digiflazzStatus === "gagal"
                    ? ("FAILED" as any)
                    : ("PENDING" as any),
              serialNumber: dfData?.sn ?? existing.serialNumber,
              providerData: {
                ...currentProviderData,
                retryCount: nextRetryCount,
                retryRefId,
                retryRequestedAt: new Date().toISOString(),
                retryResponse: dfData ?? requestTrx,
                retryHistory: [
                  ...retryHistory,
                  {
                    attempt: nextRetryCount,
                    refId: retryRefId,
                    requestedAt: new Date().toISOString(),
                    requestStatus: dfData?.status ?? null,
                    requestMessage: dfData?.message ?? null,
                    response: dfData ?? requestTrx,
                  },
                ],
              } as any,
              updatedAt: new Date(),
            },
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

          await createActivityLog(fastify, {
            actorUserId: req.user?.id,
            actorName: req.user?.displayName ?? req.user?.email ?? null,
            actorRole: req.user?.role ?? null,
            action: "transaction.retry_order",
            entityType: "transaction",
            entityId: retried.id,
            entityLabel: retried.trxId,
            description: `Retry order transaksi ${retried.trxId}`,
            metadata: {
              retryRefId,
              retryCount: nextRetryCount,
              digiflazzStatus: dfData?.status ?? null,
            },
          });

          return reply.send(
            serializeData({
              message:
                digiflazzStatus === "sukses"
                  ? "Retry order berhasil, Digiflazz langsung sukses"
                  : digiflazzStatus === "gagal"
                    ? "Retry order terkirim, tapi Digiflazz langsung balas gagal"
                    : "Retry order berhasil dikirim ke Digiflazz dan sedang diproses",
              transaction: retried,
              digiflazz: requestTrx,
            }),
          );
        } catch (error: any) {
          req.log.error({ error, trxId: existing.trxId, retryRefId }, "Retry order Digiflazz failed");
          return reply.status(502).send({
            message: error?.data?.message ?? error?.message ?? "Gagal retry order ke Digiflazz",
          });
        }
      }

      const nextPaymentStatus = paymentStatus?.trim();
      const nextOrderStatus = orderStatus?.trim();
      if (
        nextPaymentStatus &&
        !allowedPaymentStatuses.includes(nextPaymentStatus as (typeof allowedPaymentStatuses)[number])
      ) {
        return reply.status(400).send({ message: "Invalid payment status" });
      }

      if (
        nextOrderStatus &&
        !allowedOrderStatuses.includes(nextOrderStatus as (typeof allowedOrderStatuses)[number])
      ) {
        return reply.status(400).send({ message: "Invalid order status" });
      }

      if (!nextPaymentStatus && !nextOrderStatus) {
        return reply.status(400).send({ message: "No valid changes provided" });
      }

      const updated = await fastify.prisma.transactions.update({
        where: { id: existing.id },
        data: {
          ...(nextPaymentStatus ? { paymentStatus: nextPaymentStatus as any } : {}),
          ...(nextOrderStatus ? { orderStatus: nextOrderStatus as any } : {}),
        },
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

      await createActivityLog(fastify, {
        actorUserId: req.user?.id,
        actorName: req.user?.displayName ?? req.user?.email ?? null,
        actorRole: req.user?.role ?? null,
        action: "transaction.admin_update",
        entityType: "transaction",
        entityId: updated.id,
        entityLabel: updated.trxId,
        description: `Update manual transaksi ${updated.trxId}`,
        metadata: {
          before: {
            paymentStatus: existing.paymentStatus,
            orderStatus: existing.orderStatus,
          },
          after: {
            paymentStatus: updated.paymentStatus,
            orderStatus: updated.orderStatus,
          },
        },
      });

      return reply.send(
        serializeData({
          message: "Transaction updated successfully",
          transaction: updated,
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

      const { from, to, paymentStatus, orderStatus } = req.query as {
        from?: string;
        to?: string;
        paymentStatus?: string;
        orderStatus?: string;
      };
      const baseWhere: Prisma.TransactionsWhereInput = {
        ...(paymentStatus ? { paymentStatus: paymentStatus as any } : {}),
        ...(orderStatus ? { orderStatus: orderStatus as any } : {}),
      };

      if (from || to) {
        baseWhere.createdAt = {};
        if (from) baseWhere.createdAt.gte = new Date(from);
        if (to) baseWhere.createdAt.lte = new Date(to);
      }

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const sevenDaysAgo = new Date(startOfToday);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

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
        todayCount,
        todaySum,
        sevenDayCount,
        sevenDaySum,
        recentTransactions,
        topProductsRaw,
        trxWithProductAll,
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
        fastify.prisma.transactions.count({ where: { ...baseWhere, createdAt: { gte: startOfToday } } }),
        fastify.prisma.transactions.aggregate({ where: { ...baseWhere, createdAt: { gte: startOfToday } }, _sum: { totalPrice: true } }),
        fastify.prisma.transactions.count({ where: { ...baseWhere, createdAt: { gte: sevenDaysAgo } } }),
        fastify.prisma.transactions.aggregate({ where: { ...baseWhere, createdAt: { gte: sevenDaysAgo } }, _sum: { totalPrice: true } }),
        fastify.prisma.transactions.findMany({
          where: baseWhere,
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            product: { select: { id: true, title: true, thumbnails: true } },
            paymentMethod: { select: { paymentName: true, thumbnail: true, methodCode: true, source: true } },
          },
        }),
        fastify.prisma.transactions.groupBy({
          by: ["productId"],
          where: baseWhere,
          _sum: { totalPrice: true },
          _count: { _all: true },
          orderBy: { _sum: { totalPrice: "desc" } },
          take: 10,
        }),
        fastify.prisma.transactions.findMany({
          where: baseWhere,
          include: {
            product: {
              select: {
                id: true,
                title: true,
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

      const safeTopProductsRaw = topProductsRaw.filter(
        (row): row is typeof topProductsRaw[number] & { productId: string } => !!row.productId,
      );

      const topProductIds = safeTopProductsRaw
        .map((row) => row.productId)
        .filter((id, index, arr) => arr.indexOf(id) === index)
        .slice(0, 5);

      const topProductMeta = topProductIds.length
        ? await fastify.prisma.products.findMany({
            where: { id: { in: topProductIds } },
            select: { id: true, title: true, thumbnails: true },
          })
        : [];

      const topProducts = safeTopProductsRaw.slice(0, 5).map((row) => {
        const product = topProductMeta.find((item) => item.id === row.productId);
        const count = typeof row._count === "object" && row._count ? (row._count as any)._all ?? 0 : 0;
        const sum = typeof row._sum === "object" && row._sum ? (row._sum as any).totalPrice ?? 0 : 0;

        return {
          productId: row.productId,
          title: product?.title ?? "Unknown product",
          thumbnail: product?.thumbnails ?? null,
          count,
          sum: toNumber(sum),
        };
      });

      const alerts: { type: string; level: "info" | "warning" | "danger"; message: string }[] = [];
      if (totalPaymentPendingCount > 0) {
        alerts.push({ type: "payment_pending", level: "warning", message: `${totalPaymentPendingCount} transaksi masih menunggu pembayaran.` });
      }
      if (totalOrderFailedCount > 0) {
        alerts.push({ type: "order_failed", level: "danger", message: `${totalOrderFailedCount} transaksi order gagal dan perlu dicek.` });
      }
      if (totalPaymentFailedCount > 0) {
        alerts.push({ type: "payment_failed", level: "warning", message: `${totalPaymentFailedCount} transaksi gagal dibayar.` });
      }

      const trendMap = new Map<string, { date: string; totalTransactions: number; totalRevenue: number }>();
      for (let i = 0; i < 7; i++) {
        const d = new Date(sevenDaysAgo);
        d.setDate(sevenDaysAgo.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        trendMap.set(key, { date: key, totalTransactions: 0, totalRevenue: 0 });
      }
      for (const trx of trxWithProductAll as any[]) {
        const key = new Date(trx.createdAt).toISOString().slice(0, 10);
        const item = trendMap.get(key);
        if (!item) continue;
        item.totalTransactions += 1;
        item.totalRevenue += toNumber(trx.totalPrice);
      }
      const trends = Array.from(trendMap.values());

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
        periodStats: {
          today: {
            totalTransactions: todayCount,
            totalRevenue: toNumber(todaySum._sum.totalPrice),
          },
          last7Days: {
            totalTransactions: sevenDayCount,
            totalRevenue: toNumber(sevenDaySum._sum.totalPrice),
          },
        },
        funnel: {
          totalCreated: totalCount,
          paymentSuccess: totalPaymentSuccessCount,
          orderSuccess: totalOrderSuccessCount,
          paymentFailed: totalPaymentFailedCount,
          orderFailed: totalOrderFailedCount,
          waitPayment: totalOrderWaitPaymentCount,
        },
        recentTransactions,
        topProducts,
        topSubCategories: perSubCategory.slice(0, 5),
        alerts,
        quickActions: [
          { label: "Lihat transaksi pending", href: "/admin/transactions?paymentStatus=PENDING" },
          { label: "Lihat order gagal", href: "/admin/transactions?orderStatus=FAILED" },
          { label: "Kelola produk", href: "/admin/products" },
          { label: "Kelola pembayaran", href: "/admin/payments" },
        ],
        trends,
      }));
    },
  });
}
