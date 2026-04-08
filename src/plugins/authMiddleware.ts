import { FastifyReply, FastifyRequest } from "fastify";
import { getUserFromAccessToken } from "../utils/auth";

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
  } catch (error) {
    req.log.warn({ error }, "Authentication failed");
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
