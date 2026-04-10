import { FastInstance } from "../utils/fastify";

function getStartOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function leaderboardRoute(fastify: FastInstance) {
  const buildBoard = async (startDate: Date) => {
    const transactions = await fastify.prisma.transactions.findMany({
      where: {
        paymentStatus: "SUCCESS",
        createdAt: { gte: startDate },
      },
      include: {
        product: {
          select: {
            title: true,
            thumbnails: true,
            subCategory: {
              select: {
                title: true,
              },
            },
          },
        },
        user: {
          select: {
            displayName: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const grouped = new Map<string, any>();

    for (const trx of transactions) {
      const buyerName = trx.user?.displayName || trx.email || trx.phoneNumber || "Pelanggan";
      const key = trx.userId || trx.email || trx.phoneNumber || trx.id;
      const totalAmount = Number(trx.totalPrice ?? 0);
      const quantity = Number(trx.quantity ?? 1);

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          buyerName,
          productTitle: trx.product?.title || trx.product?.subCategory?.title || "Produk",
          totalAmount: 0,
          totalOrders: 0,
          totalQuantity: 0,
          lastCreatedAt: trx.createdAt,
        });
      }

      const item = grouped.get(key);
      item.totalAmount += totalAmount;
      item.totalOrders += 1;
      item.totalQuantity += quantity;
      if (new Date(trx.createdAt) > new Date(item.lastCreatedAt)) {
        item.lastCreatedAt = trx.createdAt;
        item.productTitle = trx.product?.title || trx.product?.subCategory?.title || item.productTitle;
      }
    }

    return Array.from(grouped.values())
      .sort((a, b) => {
        if (b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount;
        if (b.totalOrders !== a.totalOrders) return b.totalOrders - a.totalOrders;
        return new Date(b.lastCreatedAt).getTime() - new Date(a.lastCreatedAt).getTime();
      })
      .slice(0, 10);
  };

  fastify.get("/leaderboard", async (_req, reply) => {
    const [today, week, month] = await Promise.all([
      buildBoard(getStartOfDay()),
      buildBoard(getStartOfWeek()),
      buildBoard(getStartOfMonth()),
    ]);

    return reply.send({
      today,
      week,
      month,
      updatedAt: new Date().toISOString(),
    });
  });
}
