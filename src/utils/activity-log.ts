import type { FastInstance } from "../utils/fastify";

export async function createActivityLog(
  fastify: FastInstance,
  input: {
    actorUserId?: string | null;
    actorName?: string | null;
    actorRole?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    entityLabel?: string | null;
    description?: string | null;
    metadata?: unknown;
  },
) {
  try {
    await fastify.prisma.activityLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        actorName: input.actorName ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityLabel: input.entityLabel ?? null,
        description: input.description ?? null,
        metadata: (input.metadata ?? null) as any,
      },
    });
  } catch (error) {
    fastify.log.error({ error, input }, "failed to write activity log");
  }
}
