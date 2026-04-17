import { authMiddleware } from "../plugins/authMiddleware";
import {
  UserFieldPayload,
  createUserLoginSchema,
  createUserSchema,
} from "../schemas/user.schema";
import { hashPassword, verifyPassword } from "../utils/hash";
import { createToken } from "../utils/token";
import { FastInstance } from "../utils/fastify";
import { DuitKu, Midtrans } from "../utils/payment";

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

export default async function userRoutes(fastify: FastInstance) {
  const ensureAdmin = (user: any, reply: any): boolean => {
    if (!user || user.role !== "admin") {
      reply.status(403).send({
        message: "You do not have permission to perform this action.",
      });
      return false;
    }
    return true;
  };

  // GET /users - list users (admin only)
  fastify.get("/users", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user, reply)) return;

      const {
        q = "",
        role = "",
        page = "1",
        limit = "20",
      } = (req.query ?? {}) as Record<string, string>;

      const pageNumber = Math.max(Number(page) || 1, 1);
      const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);
      const skip = (pageNumber - 1) * limitNumber;
      const search = q.trim();
      const roleFilter = role.trim();

      const where = {
        AND: [
          roleFilter ? { role: roleFilter as any } : {},
          search
            ? {
                OR: [
                  { email: { contains: search } },
                  { displayName: { contains: search } },
                  { id: { contains: search } },
                ],
              }
            : {},
        ],
      } as any;

      const [items, total] = await Promise.all([
        fastify.prisma.user.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: limitNumber,
          select: {
            id: true,
            email: true,
            displayName: true,
            loginProvider: true,
            role: true,
            createdAt: true,
            updatedAt: true,
            isSellerVerified: true,
            emailVerified: true,
            currency: true,
            _count: {
              select: {
                products: true,
                transactions: true,
              },
            },
            // summary saldo/point
            userBalances: {
              select: {
                type: true,
                amount: true,
              },
            },
          },
        }),
        fastify.prisma.user.count({ where }),
      ]);

      return reply.send({
        items: convertBigIntAndDate(items),
        meta: {
          total,
          page: pageNumber,
          limit: limitNumber,
          totalPages: Math.max(Math.ceil(total / limitNumber), 1),
        },
      });
    },
  });

  // GET /users/self - current user profile + saldo & points
  fastify.get("/users/self", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const userId = (req.user as any)?.id as string | undefined;

      if (!userId) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          displayName: true,
          loginProvider: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          isSellerVerified: true,
          emailVerified: true,
          currency: true,
          userBalances: {
            select: {
              type: true,
              amount: true,
            },
          },
        },
      });

      if (!user) {
        return reply.status(404).send({ message: "User not found" });
      }

      return reply.send(convertBigIntAndDate(user));
    },
  });

  fastify.post("/users/balance-topups", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user as any;
      if (!user?.id) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const { amount, paymentMethodId } = (req.body ?? {}) as {
        amount?: number;
        paymentMethodId?: number;
      };

      if (!Number.isFinite(amount) || Number(amount) <= 0) {
        return reply
          .status(400)
          .send({ message: "Nominal topup tidak valid." });
      }

      if (!paymentMethodId) {
        return reply
          .status(400)
          .send({ message: "Metode pembayaran wajib dipilih." });
      }

      const paymentMethod = await fastify.prisma.paymentMethod.findFirst({
        where: {
          id: Number(paymentMethodId),
          paymentVisibility: "active",
          source: { in: ["DUITKU", "MIDTRANS"] },
        },
      });

      if (!paymentMethod) {
        return reply
          .status(404)
          .send({ message: "Metode pembayaran topup tidak ditemukan." });
      }

      const nominal = Math.round(Number(amount));
      const fee =
        paymentMethod.feeType === "percent"
          ? Math.round((paymentMethod.feeValue * nominal) / 100)
          : Math.round(paymentMethod.feeValue);
      const totalAmount = nominal + fee;

      const duitku = new DuitKu();
      const midtrans = new Midtrans();
      const topupCode = `TU-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      const duitkuBaseCallbackUrl = process.env.DUITKU_CALLBACK_URL;
      const duitkuReturnUrl = process.env.DUITKU_RETURN_URL;
      const midtransFinishUrl = process.env.MIDTRANS_FINISH_URL;
      const duitkuCallbackUrl = duitkuBaseCallbackUrl?.replace(
        "/callback/payment/duitku",
        "/callback/balance-topup/duitku",
      );

      let requestPayment: any;
      try {
        if (paymentMethod.source === "DUITKU") {
          if (!duitkuCallbackUrl || !duitkuReturnUrl) {
            return reply.status(500).send({
              message: "DUITKU callback/return URL belum dikonfigurasi.",
            });
          }

          requestPayment = await duitku.createPayment({
            amount: totalAmount,
            itemName: `Topup Saldo ${nominal.toLocaleString("id-ID")}`,
            quantity: 1,
            merchantOrderId: topupCode,
            paymentMethod: paymentMethod.methodCode,
            email: user.email,
            phoneNumber: "",
            callbackUrl: duitkuCallbackUrl,
            returnUrl: duitkuReturnUrl,
          });
        } else {
          requestPayment = await midtrans.createPayment(
            {
              orderId: topupCode,
              amount: totalAmount,
              itemName: `Topup Saldo ${nominal.toLocaleString("id-ID")}`,
              quantity: 1,
              paymentMethod: paymentMethod.methodCode,
              email: user.email,
              phoneNumber: "",
              finishUrl: midtransFinishUrl,
            },
            process.env.MIDTRANS_IS_PRODUCTION === "true",
          );
        }
      } catch (error: any) {
        return reply.status(502).send({
          message: error?.message ?? "Gagal membuat pembayaran topup.",
        });
      }

      const topup = await fastify.prisma.balanceTopup.create({
        data: {
          topupCode,
          userId: user.id,
          amount: BigInt(nominal),
          fee,
          totalAmount: BigInt(totalAmount),
          paymentMethodId: paymentMethod.id,
          paymentStatus: "PENDING",
          paymentDetails: requestPayment,
          source: paymentMethod.source,
          providerRef:
            requestPayment?.reference ?? requestPayment?.transaction_id ?? null,
        },
        include: {
          paymentMethod: true,
        },
      });

      return reply.status(201).send(convertBigIntAndDate(topup));
    },
  });

  fastify.get("/users/balance-topups", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user as any;
      if (!user?.id) return reply.status(401).send({ message: "Unauthorized" });
      const { page = "1", limit = "10" } = (req.query ?? {}) as Record<
        string,
        string
      >;
      const pageNumber = Math.max(Number(page) || 1, 1);
      const limitNumber = Math.min(Math.max(Number(limit) || 10, 1), 100);
      const skip = (pageNumber - 1) * limitNumber;
      const [items, total] = await Promise.all([
        fastify.prisma.balanceTopup.findMany({
          where: { userId: user.id },
          include: { paymentMethod: true },
          orderBy: { createdAt: "desc" },
          skip,
          take: limitNumber,
        }),
        fastify.prisma.balanceTopup.count({ where: { userId: user.id } }),
      ]);
      return reply.send(
        convertBigIntAndDate({
          items,
          meta: {
            total,
            page: pageNumber,
            limit: limitNumber,
            totalPages: Math.max(Math.ceil(total / limitNumber), 1),
          },
        }),
      );
    },
  });

  fastify.get("/users/balance-topups/:invoiceId", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user as any;
      if (!user?.id) return reply.status(401).send({ message: "Unauthorized" });

      const data = await fastify.prisma.balanceTopup.findFirst({
        where: { topupCode: (req.params as any).invoiceId },
        include: { paymentMethod: true },
      });
      return reply.send(convertBigIntAndDate(data));
    },
  });

  fastify.get("/users/balance-history", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const user = req.user as any;
      if (!user?.id) return reply.status(401).send({ message: "Unauthorized" });
      const {
        page = "1",
        limit = "10",
        type = "ALL",
      } = (req.query ?? {}) as Record<string, string>;
      const pageNumber = Math.max(Number(page) || 1, 1);
      const limitNumber = Math.min(Math.max(Number(limit) || 10, 1), 100);
      const skip = (pageNumber - 1) * limitNumber;

      const moneyItems =
        type === "POINTS"
          ? []
          : (
              await fastify.prisma.moneyEntry.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: "desc" },
              })
            ).map((item) => ({ ...item, entryType: "WALLET" }));
      const pointItems =
        type === "WALLET"
          ? []
          : (
              await fastify.prisma.pointEntry.findMany({
                where: { userId: user.id },
                orderBy: { createdAt: "desc" },
              })
            ).map((item) => ({ ...item, entryType: "POINTS" }));
      const merged = [...moneyItems, ...pointItems].sort(
        (a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      const items = merged.slice(skip, skip + limitNumber);
      const total = merged.length;

      return reply.send(
        convertBigIntAndDate({
          items,
          meta: {
            total,
            page: pageNumber,
            limit: limitNumber,
            totalPages: Math.max(Math.ceil(total / limitNumber), 1),
          },
        }),
      );
    },
  });

  fastify.post("/admin/users/:id/balance-adjust", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user, reply)) return;
      const { id } = req.params as { id: string };
      const { type, amount, note } = (req.body ?? {}) as {
        type?: "WALLET" | "POINTS";
        amount?: number;
        note?: string;
      };

      if (!type || !["WALLET", "POINTS"].includes(type)) {
        return reply.status(400).send({ message: "Tipe balance tidak valid." });
      }

      if (!Number.isFinite(amount) || Number(amount) === 0) {
        return reply
          .status(400)
          .send({ message: "Nominal adjustment tidak valid." });
      }

      const numericAmount = Math.round(Number(amount));
      const result = await fastify.prisma.$transaction(async (tx) => {
        await tx.userBalance.upsert({
          where: { userId_type: { userId: id, type } },
          update: { amount: { increment: numericAmount } },
          create: { userId: id, type, amount: numericAmount },
        });

        if (type === "POINTS") {
          await tx.pointEntry.create({
            data: {
              userId: id,
              amount: numericAmount,
              ref: `ADMIN-ADJ-${Date.now()}`,
              meta: {
                note,
                actorUserId: req.user?.id,
                type: "ADMIN_ADJUSTMENT",
              } as any,
            },
          });
        } else {
          await tx.moneyEntry.create({
            data: {
              userId: id,
              amount: BigInt(numericAmount),
              ref: `ADMIN-ADJ-${Date.now()}`,
              meta: {
                note,
                actorUserId: req.user?.id,
                type: "ADMIN_ADJUSTMENT",
              } as any,
            },
          });
        }

        return tx.user.findUnique({
          where: { id },
          select: { id: true, userBalances: true },
        });
      });

      return reply.send(convertBigIntAndDate(result));
    },
  });

  fastify.get("/admin/balance-topups", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user, reply)) return;
      const {
        status = "",
        from = "",
        to = "",
      } = (req.query ?? {}) as Record<string, string>;
      const items = await fastify.prisma.balanceTopup.findMany({
        where: {
          ...(status ? { paymentStatus: status as any } : {}),
          ...(from || to
            ? {
                createdAt: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              }
            : {}),
        },
        include: { user: true, paymentMethod: true },
        orderBy: { createdAt: "desc" },
      });
      return reply.send(convertBigIntAndDate(items));
    },
  });

  // POST /users/auth/logout
  fastify.post("/users/auth/logout", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        return reply.status(400).send({ message: "Invalid access token" });
      }

      const bearerToken = header.replace("Bearer ", "").trim();

      await fastify.prisma.loginSession.deleteMany({
        where: { jwtToken: bearerToken },
      });

      return reply.send({ message: "Logout successful." });
    },
  });

  // GET /users/auth/logout (opsional)
  fastify.get("/users/auth/logout", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        return reply.status(400).send({ message: "Invalid access token" });
      }

      const bearerToken = header.replace("Bearer ", "").trim();

      await fastify.prisma.loginSession.deleteMany({
        where: { jwtToken: bearerToken },
      });

      return reply.send({ message: "Logout successful." });
    },
  });

  // POST /users/auth/register
  fastify.post("/users/auth/register", {
    schema: {
      body: createUserSchema,
    },
    handler: async (req, reply) => {
      const body = req.body as UserFieldPayload;

      let passwordHash: string | undefined;
      if (body.password) {
        passwordHash = await hashPassword(body.password);
      }

      const ipList = [req.ip, ...(req.ips || [])].filter(Boolean);
      const ipaddr = ipList.join(",");

      try {
        const user = await fastify.prisma.user.create({
          data: {
            email: body.email,
            displayName: body.displayName,
            passwordHash,
            loginProvider: body.loginProvider,
            role: body.role,
            // initial balances
            userBalances: {
              create: [
                {
                  type: "WALLET",
                  amount: BigInt(0),
                },
                {
                  type: "POINTS",
                  amount: BigInt(0),
                },
              ],
            },
          },
          include: {
            userBalances: true,
          },
        });

        const userToken = createToken({
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          role: user.role,
        });

        const session = await fastify.prisma.loginSession.create({
          data: {
            userId: user.id,
            user_agent: req.headers["user-agent"],
            ip_addr: ipaddr,
            jwtToken: userToken,
            lastSeenAt: new Date(),
          },
        });

        return reply.status(201).send(session);
      } catch (error: any) {
        if (error.code === "P2002") {
          return reply.status(409).send({
            message:
              "Mohon gunakan email lain yang belum pernah digunakan sebelumnya.",
          });
        }

        throw error;
      }
    },
  });

  // POST /users/auth/login
  fastify.post("/users/auth/login", {
    schema: {
      body: createUserLoginSchema,
    },
    handler: async (req, reply) => {
      const ipList = [req.ip, ...(req.ips || [])].filter(Boolean);
      const ipaddr = ipList.join(",");

      const body = req.body as UserFieldPayload;

      const userByEmail = await fastify.prisma.user.findFirst({
        where: { email: body.email },
      });

      if (!userByEmail || !userByEmail.passwordHash) {
        return reply.status(401).send({
          message: "Email atau password yang Anda masukan salah.",
        });
      }

      const isValid = await verifyPassword(
        body.password!,
        userByEmail.passwordHash,
      );

      if (!isValid) {
        return reply.status(401).send({
          message: "Email atau password yang Anda masukan salah.",
        });
      }

      const userToken = createToken({
        id: userByEmail.id,
        displayName: userByEmail.displayName,
        email: userByEmail.email,
        role: userByEmail.role,
      });

      const session = await fastify.prisma.loginSession.upsert({
        where: { userId: userByEmail.id },
        update: {
          user_agent: req.headers["user-agent"],
          ip_addr: ipaddr,
          jwtToken: userToken,
          lastSeenAt: new Date(),
        },
        create: {
          userId: userByEmail.id,
          user_agent: req.headers["user-agent"],
          ip_addr: ipaddr,
          jwtToken: userToken,
          lastSeenAt: new Date(),
        },
      });

      return reply.send(session);
    },
  });

  // POST /admin/users/:id/init-balances
  fastify.post("/users/:id/init-balances", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const currentUser = req.user as any;
      if (!currentUser || currentUser.role !== "admin") {
        return reply.status(403).send({
          message: "You do not have permission to perform this action.",
        });
      }

      const userId = (req.params as any).id as string;

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });

      if (!user) {
        return reply.status(404).send({ message: "User not found." });
      }

      try {
        const result = await fastify.prisma.$transaction(async (tx) => {
          // cek existing balances
          const existingBalances = await tx.userBalance.findMany({
            where: {
              userId: userId,
            },
          });

          const hasWallet = existingBalances.some((b) => b.type === "WALLET");
          const hasPoints = existingBalances.some((b) => b.type === "POINTS");

          const creates: Promise<any>[] = [];

          if (!hasWallet) {
            creates.push(
              tx.userBalance.create({
                data: {
                  userId,
                  type: "WALLET",
                  amount: BigInt(0),
                },
              }),
            );
          }

          if (!hasPoints) {
            creates.push(
              tx.userBalance.create({
                data: {
                  userId,
                  type: "POINTS",
                  amount: BigInt(0),
                },
              }),
            );
          }

          if (creates.length > 0) {
            await Promise.all(creates);
          }

          const balancesAfter = await tx.userBalance.findMany({
            where: { userId },
            select: {
              type: true,
              amount: true,
            },
          });

          return balancesAfter;
        });

        return reply.send({
          message: "User balances initialized successfully.",
          userId,
          balances: convertBigIntAndDate(result),
        });
      } catch (err) {
        req.log.error({ err }, "Init user balances failed");
        return reply.status(500).send({
          message: "Terjadi kesalahan saat menginisialisasi saldo user.",
        });
      }
    },
  });
}
