"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const prisma_1 = __importDefault(require("./plugins/prisma"));
const user_route_1 = __importDefault(require("./routes/user.route"));
const github_webhook_route_1 = __importDefault(require("./routes/github-webhook.route"));
const response_1 = __importDefault(require("./plugins/response"));
const fastify_raw_body_1 = __importDefault(require("fastify-raw-body"));
const buildServer = () => {
    const app = (0, fastify_1.default)({ logger: true });
    (0, response_1.default)(app);
    app.register(fastify_raw_body_1.default, {
        field: 'rawBody', // nama property di request
        global: false, // true = semua route, false = register manual
        runFirst: true,
        encoding: 'utf8', // atau null untuk Buffer
    });
    app.register(prisma_1.default);
    app.register(user_route_1.default);
    app.register(github_webhook_route_1.default);
    return app;
};
exports.default = buildServer;
