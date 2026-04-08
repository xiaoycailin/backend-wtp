"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const server_1 = __importDefault(require("./server"));
const start = async () => {
    const server = await (0, server_1.default)();
    try {
        const port = Number(process.env.PORT) || 3000;
        await server.listen({ port, host: "0.0.0.0" });
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
};
start();
