import type { FastInstance } from "../utils/fastify";

export async function createSystemLog(
  fastify: FastInstance,
  input: {
    type: string;
    source: string;
    message: string;
    statusCode?: number | null;
    method?: string | null;
    url?: string | null;
    trxId?: string | null;
    provider?: string | null;
    requestPayload?: unknown;
    responsePayload?: unknown;
    errorStack?: string | null;
    metadata?: unknown;
  },
) {
  try {
    await (fastify.prisma as any).systemLog.create({
      data: {
        type: input.type,
        source: input.source,
        message: input.message,
        statusCode: input.statusCode ?? null,
        method: input.method ?? null,
        url: input.url ?? null,
        trxId: input.trxId ?? null,
        provider: input.provider ?? null,
        requestPayload: (input.requestPayload ?? null) as any,
        responsePayload: (input.responsePayload ?? null) as any,
        errorStack: input.errorStack ?? null,
        metadata: (input.metadata ?? null) as any,
      },
    });
  } catch (error) {
    fastify.log.error({ error, input }, "failed to write system log");
  }
}
