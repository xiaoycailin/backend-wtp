import { authMiddleware } from "../plugins/authMiddleware";
import {
  UserFieldPayload,
  createUserLoginSchema,
  createUserSchema,
} from "../schemas/user.schema";
import { hashPassword, verifyPassword } from "../utils/hash";
import { createToken } from "../utils/token";
import { FastInstance } from "../utils/fastify";

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

  fastify.get("/users", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user, reply)) return;

      const { q = "", role = "", page = "1", limit = "20" } = (req.query ?? {}) as Record<string, string>;
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
          },
        }),
        fastify.prisma.user.count({ where }),
      ]);

      return reply.send({
        items,
        meta: {
          total,
          page: pageNumber,
          limit: limitNumber,
          totalPages: Math.max(Math.ceil(total / limitNumber), 1),
        },
      });
    },
  });

  fastify.get("/users/self", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      reply.send(req.user);
    },
  });

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
}
