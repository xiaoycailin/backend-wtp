"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const prisma_1 = __importDefault(require("./plugins/prisma"));
const response_1 = __importDefault(require("./plugins/response"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const static_1 = __importDefault(require("@fastify/static"));
const path_1 = require("path");
const user_route_1 = __importDefault(require("./routes/user.route"));
const products_route_1 = __importDefault(require("./routes/products.route"));
const category_route_1 = __importDefault(require("./routes/category.route"));
const upload_image_route_1 = __importDefault(require("./routes/upload-image.route"));
const payment_route_1 = __importDefault(require("./routes/payment.route"));
const callback_route_1 = __importDefault(require("./routes/callback.route"));
const transaction_route_1 = __importDefault(require("./routes/transaction.route"));
const game_check_route_1 = __importDefault(require("./routes/game-check.route"));
const siteconfig_route_1 = __importDefault(require("./routes/siteconfig.route"));
const github_webhook_route_1 = __importDefault(require("./routes/github-webhook.route"));
const activity_route_1 = __importDefault(require("./routes/activity.route"));
const system_log_route_1 = __importDefault(require("./routes/system-log.route"));
const badge_route_1 = __importDefault(require("./routes/badge.route"));
const leaderboard_route_1 = __importDefault(require("./routes/leaderboard.route"));
const banner_route_1 = __importDefault(require("./routes/banner.route"));
const cache_1 = __importDefault(require("./plugins/cache"));
const promotion_route_1 = __importDefault(require("./routes/promotion.route"));
const input_types_route_1 = __importDefault(require("./routes/input-types.route"));
const apiRoutesPlugin = async (instance) => {
    await instance.register(user_route_1.default);
    await instance.register(category_route_1.default);
    await instance.register(products_route_1.default);
    await instance.register(upload_image_route_1.default);
    await instance.register(payment_route_1.default);
    await instance.register(transaction_route_1.default);
    await instance.register(callback_route_1.default);
    await instance.register(game_check_route_1.default);
    await instance.register(siteconfig_route_1.default);
    await instance.register(activity_route_1.default);
    await instance.register(system_log_route_1.default);
    await instance.register(badge_route_1.default);
    await instance.register(leaderboard_route_1.default);
    await instance.register(banner_route_1.default);
    await instance.register(promotion_route_1.default);
    await instance.register(input_types_route_1.default);
    await instance.register(github_webhook_route_1.default);
};
const buildServer = async () => {
    const app = (0, fastify_1.default)({
        logger: {
            transport: {
                target: "pino-pretty",
                options: {
                    colorize: true,
                },
            },
        },
    });
    (0, response_1.default)(app);
    await app.register(multipart_1.default, {
        limits: {
            fileSize: 5 * 1024 * 1024,
        },
    });
    app.register(static_1.default, {
        root: (0, path_1.join)(process.cwd(), "static"),
        prefix: "/static/",
    });
    await app.register(prisma_1.default);
    await app.register(cache_1.default);
    app.get("/health", async () => {
        return {
            ok: true,
            service: "backendwtp-update",
            version: "1",
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.round(process.uptime()),
        };
    });
    app.get("/health/db", async (_req, reply) => {
        try {
            await app.prisma.$queryRaw `SELECT 1`;
            return {
                ok: true,
                database: "reachable",
                timestamp: new Date().toISOString(),
            };
        }
        catch (error) {
            app.log.error({ error }, "Database health check failed");
            return reply.status(500).send({
                ok: false,
                database: "unreachable",
                timestamp: new Date().toISOString(),
            });
        }
    });
    await app.register(apiRoutesPlugin); // tanpa prefix
    await app.register(apiRoutesPlugin, { prefix: "/api/v1" }); // dengan /api/v1
    return app;
};
exports.default = buildServer;
