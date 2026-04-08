"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
function default_1(fastify) {
    fastify.addHook("onRequest", async (req) => {
        req.startTime = process.hrtime();
    });
    fastify.addHook("onSend", async (req, reply, payload) => {
        const contentType = reply.getHeader("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            return payload;
        }
        const start = req.startTime ?? process.hrtime();
        const diff = process.hrtime(start);
        const durationMs = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2) + "ms";
        let parsed;
        try {
            parsed = JSON.parse(payload);
        }
        catch {
            return payload;
        }
        return JSON.stringify({
            status: reply.statusCode,
            duration: durationMs,
            data: parsed,
        });
    });
    fastify.setErrorHandler((error, req, reply) => {
        const start = req.startTime ?? process.hrtime();
        const diff = process.hrtime(start);
        const durationMs = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2) + "ms";
        if (error?.code === "P2002" && Array.isArray(error?.meta?.target)) {
            const targetFields = error.meta.target.join(", ");
            return reply.status(409).send({
                code: "DUPLICATE_ENTRY",
                message: `${targetFields} sudah terdaftar`,
                duration: durationMs,
            });
        }
        if (error?.code === "P2025") {
            return reply.status(404).send({
                code: "NOT_FOUND",
                message: "Data tidak ditemukan",
                duration: durationMs,
            });
        }
        if (error?.validation) {
            return reply.status(400).send({
                code: "VALIDATION_ERROR",
                message: error.message,
                duration: durationMs,
            });
        }
        fastify.log.error(error);
        const statusCode = error?.statusCode ?? 500;
        return reply.status(statusCode).send({
            code: "INTERNAL_SERVER_ERROR",
            message: "Terjadi kesalahan di server",
            duration: durationMs,
        });
    });
}
