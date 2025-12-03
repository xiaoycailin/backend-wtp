"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const prisma_1 = __importDefault(require("./plugins/prisma"));
const user_route_1 = __importDefault(require("./routes/user.route"));
const response_1 = __importDefault(require("./plugins/response"));
const buildServer = () => {
    const app = (0, fastify_1.default)({ logger: true });
    (0, response_1.default)(app);
    app.register(prisma_1.default);
    app.register(user_route_1.default);
    return app;
};
exports.default = buildServer;
