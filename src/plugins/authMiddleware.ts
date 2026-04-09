import { FastifyReply, FastifyRequest } from "fastify";
import { getUserFromAccessToken } from "../utils/auth";
import { createSystemLog } from "../utils/system-log";

export const authMiddleware = async (
  req: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const user = await getUserFromAccessToken(req.headers.authorization);

    if (!user) {
      return reply.code(401).send({ message: "Invalid access token" });
    }

    req.user = user;
  } catch (error: any) {
    req.log.warn({ error }, "Authentication failed");
    await createSystemLog(req.server as any, {
      type: "app_warning",
      source: "auth.required",
      message: error?.message ?? "Authentication failed",
      statusCode: 401,
      method: req.method,
      url: req.url,
      requestPayload: {
        hasAuthorizationHeader: Boolean(req.headers.authorization),
        userAgent: req.headers["user-agent"] ?? null,
      },
      errorStack: error?.stack ?? null,
    });
    return reply.code(401).send({ message: "Invalid access token" });
  }
};

export const optionalAuthMiddleware = async (
  req: FastifyRequest,
  _reply: FastifyReply,
) => {
  try {
    const user = await getUserFromAccessToken(req.headers.authorization);
    req.user = user ?? undefined;
  } catch (error) {
    req.log.warn({ error }, "Optional authentication failed");
    req.user = undefined;
  }
};
