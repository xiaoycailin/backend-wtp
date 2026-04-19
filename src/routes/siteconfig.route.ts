import { FastInstance } from "../utils/fastify";
import { z } from "zod";
import { authMiddleware } from "../plugins/authMiddleware";
import { ensureAdmin } from "../utils/auth";
import type { FastifyRequest, FastifyReply } from "fastify";

const UpdateSiteConfigSchema = z.object({
  siteName: z.string().max(100).optional(),
  tagline: z.string().max(200).optional(),
  description: z.string().optional(),
  siteUrl: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
  logoAlt: z.string().max(150).optional(),
  faviconUrl: z.string().url().optional(),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
  metaTitle: z.string().max(70).optional(),
  metaDescription: z.string().max(165).optional(),
  metaKeywords: z.string().max(500).optional(),
  metaRobots: z.string().max(100).optional(),
  canonicalUrl: z.string().url().optional(),
  ogTitle: z.string().max(95).optional(),
  ogDescription: z.string().max(300).optional(),
  ogImage: z.string().url().optional(),
  ogImageAlt: z.string().max(150).optional(),
  ogType: z.string().max(50).optional(),
  fbAppId: z.string().optional(),
  twitterCard: z.enum(["summary", "summary_large_image"]).optional(),
  twitterSite: z.string().max(50).optional(),
  twitterCreator: z.string().max(50).optional(),
  twitterTitle: z.string().max(70).optional(),
  twitterDescription: z.string().max(200).optional(),
  twitterImage: z.string().url().optional(),
  schemaOrgType: z.string().max(50).optional(),
  schemaOrgJson: z.string().optional(),
  googleSiteVerification: z.string().optional(),
  bingSiteVerification: z.string().optional(),
  googleAnalyticsId: z.string().optional(),
  googleTagManagerId: z.string().optional(),
  facebookPixelId: z.string().optional(),
  tiktokPixelId: z.string().optional(),
  contactEmail: z.string().email().optional(),
  supportEmail: z.string().email().optional(),
  supportWhatsapp: z.string().max(20).optional(),
  address: z.string().optional(),
  facebookUrl: z.string().url().optional(),
  instagramUrl: z.string().url().optional(),
  twitterUrl: z.string().url().optional(),
  youtubeUrl: z.string().url().optional(),
  tiktokUrl: z.string().url().optional(),
  discordUrl: z.string().url().optional(),
  telegramUrl: z.string().url().optional(),
  maintenanceMode: z.boolean().optional(),
  maintenanceTitle: z.string().max(100).optional(),
  maintenanceMessage: z.string().optional(),
  primaryColor: z.string().max(20).optional(),
  secondaryColor: z.string().max(20).optional(),
  accentColor: z.string().max(20).optional(),
});

const UpdateExtraSchema = z.object({
  extras: z
    .array(
      z.object({
        key: z.string().max(100),
        value: z.string().nullable().optional(),
        description: z.string().max(255).optional(),
        isSecret: z.boolean().optional(),
      }),
    )
    .optional(),
});

const FullUpdateSchema = UpdateSiteConfigSchema.merge(UpdateExtraSchema);

function forbidNonAdmin(req: any, reply: any) {
  if (!ensureAdmin(req.user)) {
    reply.status(403).send({ message: "Forbidden" });
    return true;
  }
  return false;
}

const CACHE_KEY = "siteconfig:full";
const CACHE_TTL = 3600; // 1 jam — siteconfig sangat jarang berubah

export default async function (fastify: FastInstance) {
  // GET /site-config
  fastify.get("/site-config", {
    handler: async (_req: FastifyRequest, reply: FastifyReply) => {
      const cached = await fastify.cache.get<any>(CACHE_KEY);
      if (cached) return reply.send(cached);

      const config = await fastify.prisma.siteConfig.findFirst({
        where: { id: 1 },
      });

      if (!config) {
        return reply
          .status(404)
          .send({ message: "Site config belum tersedia." });
      }

      const extras = await fastify.prisma.siteConfigExtra.findMany({
        where: { siteConfigId: 1 },
        select: {
          id: true,
          key: true,
          description: true,
          isSecret: true,
          updatedAt: true,
          value: true,
        },
      });

      const result = {
        ...config,
        extras: extras.map((extra) => ({
          ...extra,
          value: extra.isSecret ? "••••••••" : extra.value,
        })),
      };

      await fastify.cache.set(CACHE_KEY, result, CACHE_TTL);

      return reply.send(result);
    },
  });

  // PATCH /site-config
  fastify.patch("/site-config", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (forbidNonAdmin(req, reply)) return;

      const parsed = FullUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Validasi gagal.",
          errors: parsed.error.flatten(),
        });
      }

      const { extras, ...configData } = parsed.data;

      const config = await fastify.prisma.siteConfig.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          siteName: "WTPANJAY",
          siteUrl: "https://wtpanjay.com",
          ...configData,
        },
        update: configData,
      });

      if (extras?.length) {
        for (const extra of extras) {
          await fastify.prisma.siteConfigExtra.upsert({
            where: {
              siteConfigId_key: { siteConfigId: 1, key: extra.key },
            },
            create: {
              siteConfigId: 1,
              key: extra.key,
              value: extra.value ?? null,
              description: extra.description,
              isSecret: extra.isSecret ?? false,
            },
            update: {
              value: extra.value ?? null,
              description: extra.description,
              isSecret: extra.isSecret ?? false,
            },
          });
        }
      }

      // Invalidasi cache setelah update
      await fastify.cache.del(CACHE_KEY);

      return reply.send({
        message: "Site config berhasil diperbarui.",
        config,
      });
    },
  });

  // DELETE /site-config/extras/:key
  fastify.delete("/site-config/extras/:key", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      if (forbidNonAdmin(req, reply)) return;

      const { key } = req.params as { key: string };

      const existing = await fastify.prisma.siteConfigExtra.findUnique({
        where: { siteConfigId_key: { siteConfigId: 1, key } },
      });

      if (!existing) {
        return reply.status(404).send({
          message: `Extra config dengan key "${key}" tidak ditemukan.`,
        });
      }

      await fastify.prisma.siteConfigExtra.delete({
        where: { siteConfigId_key: { siteConfigId: 1, key } },
      });

      // Invalidasi cache karena extras berubah
      await fastify.cache.del(CACHE_KEY);

      return reply.send({
        message: `Extra config "${key}" berhasil dihapus.`,
      });
    },
  });
}
