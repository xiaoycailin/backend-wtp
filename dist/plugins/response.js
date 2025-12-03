"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
function default_1(fastify) {
    fastify.addHook('onRequest', async (req, _reply) => {
        req.startTime = process.hrtime();
    });
    // 🧱 Bungkus response
    fastify.addHook('onSend', async (req, reply, payload) => {
        const diff = process.hrtime(req.startTime);
        const durationMs = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2) + 'ms';
        let parsed;
        try {
            parsed = JSON.parse(payload);
        }
        catch (e) {
            parsed = payload; // fallback kalo payload bukan JSON
        }
        const wrapped = {
            status: reply.statusCode,
            duration: durationMs,
            data: parsed,
        };
        return JSON.stringify(wrapped);
    });
    // fastify.setErrorHandler((error, req, reply) => {
    //     const diff = process.hrtime((req as any).startTime)
    //     const durationMs = (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2) + 'ms'
    //     // Prisma error handling (bisa dikembangin lagi)
    //     let message = 'Terjadi kesalahan di server'
    //     let code = 'INTERNAL_SERVER_ERROR'
    //     let statusCode = 500
    //     if (error.code === 'P2002' && Array.isArray((error as any).meta?.target)) {
    //         const targetFields = (error as any).meta.target.join(', ')
    //         return reply.status(409).send({
    //             code: 'DUPLICATE_ENTRY',
    //             message: `${targetFields} sudah terdaftar`,
    //         })
    //     }
    //     // Format final
    //     reply.status(statusCode).send({
    //         error: 'Error',
    //         code,
    //         message
    //     })
    // })
}
