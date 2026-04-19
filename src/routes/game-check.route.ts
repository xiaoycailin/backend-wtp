import { FastInstance } from "../utils/fastify";
import {
  checkGameId,
  getSupportedGames,
  GameCode,
} from "../utils/gameIdChecker";
import { createSystemLog } from "../utils/system-log";

export default async function gameCheckRoute(fastify: FastInstance) {
  // ===========================
  // LIST SUPPORTED GAMES
  // ===========================
  fastify.get("/games/supported", {
    handler: async (_req, reply) => {
      const cacheKey = "games:supported";

      const cached = await fastify.cache.get<any[]>(cacheKey);
      if (cached) return reply.send(cached);

      const data = getSupportedGames();
      await fastify.cache.set(cacheKey, data, 86400); // TTL 24 jam

      return reply.send(data);
    },
  });
  // ===========================
  // CHECK GAME ID / USERNAME
  // ===========================
  fastify.post("/games/check-id", {
    handler: async (req, reply) => {
      const { game, userId, zoneId } = req.body as {
        game?: string;
        userId?: string;
        zoneId?: string;
      };

      if (!game) {
        return reply.status(400).send({
          message:
            "game is required. Use GET /games/supported to see available games.",
        });
      }

      if (!userId) {
        return reply.status(400).send({
          message: "userId is required.",
        });
      }

      // Validate game code
      const supportedCodes = getSupportedGames().map((g) => g.code);
      if (!supportedCodes.includes(game)) {
        return reply.status(400).send({
          message: `Unsupported game: "${game}". Supported: ${supportedCodes.join(", ")}`,
        });
      }

      try {
        const result = await checkGameId({
          game: game as GameCode,
          userId,
          zoneId,
        });

        return reply.send(result);
      } catch (error: any) {
        /**
         * Distinguish between "ID not found" (client error) and upstream
         * failures (server error).
         */
        const message = error.message ?? "Failed to check game ID";

        if (
          message.includes("not found") ||
          message.includes("invalid") ||
          message.includes("required") ||
          message.includes("prefix")
        ) {
          return reply.status(404).send({ success: false, message });
        }

        fastify.log.error(error, "Game ID check upstream error");
        await createSystemLog(fastify, {
          type: "third_party_error",
          source: "game_check.validate_user_id",
          message,
          statusCode: error?.statusCode ?? 502,
          method: req.method,
          url: req.url,
          provider: (error as any)?.provider ?? game,
          requestPayload: { game, userId, zoneId },
          responsePayload:
            (error as any)?.responsePayload ?? (error as any)?.data ?? null,
          errorStack: error?.stack ?? null,
        });
        return reply.status(502).send({
          success: false,
          message: "Failed to validate game ID. Please try again later.",
        });
      }
    },
  });
}
