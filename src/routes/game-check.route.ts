import { FastInstance } from "../utils/fastify";
import {
  checkGameId,
  getSupportedGames,
  GameCode,
} from "../utils/gameIdChecker";

export default async function gameCheckRoute(fastify: FastInstance) {
  // ===========================
  // LIST SUPPORTED GAMES
  // ===========================
  fastify.get("/games/supported", {
    handler: async (_req, reply) => {
      return reply.send(getSupportedGames());
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
        return reply.status(502).send({
          success: false,
          message: "Failed to validate game ID. Please try again later.",
        });
      }
    },
  });
}
