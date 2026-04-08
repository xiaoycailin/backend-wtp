import { PrismaClient } from "@prisma/client";

/**
 * BUG-FIX: The `user` type declaration previously listed `name` instead of
 * `displayName` (which is what the DB schema and middleware actually use).
 * Also `role` was restricted to a union that didn't match the Prisma enum,
 * and the index signature `[key: string]: string` conflicted with the
 * optional fields.
 */
declare module "fastify" {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      displayName: string | null;
      loginProvider: string;
      role: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
  }

  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
