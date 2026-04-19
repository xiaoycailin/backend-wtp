import { FastInstance } from "../utils/fastify";
import { authMiddleware } from "../plugins/authMiddleware";
import { serializeData } from "../utils/json";
import { ensureAdmin } from "../utils/auth";
import { InputEnum, InputModel } from "@prisma/client";
import { z } from "zod";

const createInputSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
  type: z.enum(["text", "number", "tel", "email", "password"] as const),
  model: z.enum(["input", "textarea", "select"] as const),
  placeholder: z.string().max(200).optional().nullable(),
  options: z.any().optional().nullable(), // JSON array of {label,value}
  icon: z.string().max(50).optional().nullable(),
  maskingForView: z.boolean().optional().default(false),
  subCategoryId: z.uuidv4(),
});

const updateInputSchema = createInputSchema.partial();

export default async function (fastify: FastInstance) {
  // GET /input-types?subCategoryId=... (admin only)
  fastify.get("/input-types", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user)) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      const { subCategoryId } = req.query as { subCategoryId?: string };
      const where = subCategoryId ? { subCategoryId } : {};

      const inputs = await fastify.prisma.inputTypes.findMany({
        where,
        orderBy: { createdAt: "asc" },
        include: {
          subCategory: {
            select: { id: true, title: true, slug: true },
          },
        },
      });

      return reply.send(serializeData(inputs));
    },
  });

  // GET /input-types/:id (admin only)
  fastify.get("/input-types/:id", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user)) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      const { id } = req.params as { id: string };
      const inputId = Number(id);
      if (!inputId || inputId <= 0) {
        return reply.status(400).send({ message: "Invalid input ID" });
      }

      const input = await fastify.prisma.inputTypes.findUnique({
        where: { id: inputId },
        include: {
          subCategory: {
            select: { id: true, title: true, slug: true },
          },
        },
      });

      if (!input) {
        return reply.status(404).send({ message: "Input type not found" });
      }

      return reply.send(serializeData(input));
    },
  });

  // POST /input-types (admin only)
  fastify.post("/input-types", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user)) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      const parsed = createInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validation error",
          errors: parsed.error,
        });
      }

      // console.log(parsed.data);

      const { subCategoryId, ...data } = parsed.data as any;
      if (!subCategoryId) {
        return reply.status(400).send({ message: "subCategoryId is required" });
      }

      // Verify subCategory exists
      const subCategory = await fastify.prisma.subCategory.findUnique({
        where: { id: subCategoryId },
      });
      if (!subCategory) {
        return reply.status(404).send({ message: "SubCategory not found" });
      }

      const input = await fastify.prisma.inputTypes.create({
        data: {
          ...data,
          subCategoryId,
        },
      });

      return reply.status(201).send(serializeData(input));
    },
  });

  // PUT /input-types/:id (admin only)
  fastify.put("/input-types/:id", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user)) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      const { id } = req.params as { id: string };
      const inputId = Number(id);
      if (!inputId || inputId <= 0) {
        return reply.status(400).send({ message: "Invalid input ID" });
      }

      const parsed = updateInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validation error",
          errors: parsed.error,
        });
      }

      const existing = await fastify.prisma.inputTypes.findUnique({
        where: { id: inputId },
      });
      if (!existing) {
        return reply.status(404).send({ message: "Input type not found" });
      }

      const data = parsed.data as any;
      if (data.subCategoryId) {
        const subCategory = await fastify.prisma.subCategory.findUnique({
          where: { id: data.subCategoryId },
        });
        if (!subCategory) {
          return reply.status(404).send({ message: "SubCategory not found" });
        }
      }

      const updated = await fastify.prisma.inputTypes.update({
        where: { id: inputId },
        data,
      });

      return reply.send(serializeData(updated));
    },
  });

  // DELETE /input-types/:id (admin only)
  fastify.delete("/input-types/:id", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (!ensureAdmin(req.user)) {
        return reply.status(403).send({ message: "Forbidden" });
      }

      const { id } = req.params as { id: string };
      const inputId = Number(id);
      if (!inputId || inputId <= 0) {
        return reply.status(400).send({ message: "Invalid input ID" });
      }

      const existing = await fastify.prisma.inputTypes.findUnique({
        where: { id: inputId },
      });
      if (!existing) {
        return reply.status(404).send({ message: "Input type not found" });
      }

      await fastify.prisma.inputTypes.delete({ where: { id: inputId } });

      return reply.send({ message: "Input type deleted successfully" });
    },
  });

  // GET /input-types/subcategory/:subCategoryId (public)
  fastify.get("/input-types/subcategory/:subCategoryId", {
    handler: async (req, reply) => {
      const { subCategoryId } = req.params as { subCategoryId: string };
      const cacheKey = `input-types:subcategory:${subCategoryId}`;

      const cached = await fastify.cache.get<any[]>(cacheKey);
      if (cached) return reply.send(cached);

      const inputs = await fastify.prisma.inputTypes.findMany({
        where: { subCategoryId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          label: true,
          type: true,
          model: true,
          placeholder: true,
          options: true,
          icon: true,
          maskingForView: true,
          createdAt: true,
        },
      });

      const result = serializeData(inputs);
      await fastify.cache.set(cacheKey, result, 3600); // TTL 1 jam

      return reply.send(result);
    },
  });

  // GET /input-types/subcategory-slug/:slug (public)
  fastify.get("/input-types/subcategory-slug/:slug", {
    handler: async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const cacheKey = `input-types:slug:${slug}`;

      const cached = await fastify.cache.get<any[]>(cacheKey);
      if (cached) return reply.send(cached);

      const subCategory = await fastify.prisma.subCategory.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!subCategory) {
        return reply.send(serializeData([]));
      }

      const inputs = await fastify.prisma.inputTypes.findMany({
        where: { subCategoryId: subCategory.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          label: true,
          type: true,
          model: true,
          placeholder: true,
          options: true,
          icon: true,
          maskingForView: true,
          createdAt: true,
        },
      });

      const result = serializeData(inputs);
      await fastify.cache.set(cacheKey, result, 3600); // TTL 1 jam

      return reply.send(result);
    },
  });
}
