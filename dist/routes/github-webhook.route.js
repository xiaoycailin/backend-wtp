"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = githubWebhook;
const child_process_1 = require("child_process");
const crypto_1 = __importDefault(require("crypto"));
const GITHUB_SECRET = 'talonsecret2025';
async function githubWebhook(fastify) {
    fastify.addContentTypeParser('*', { parseAs: 'buffer' }, function (req, body, done) {
        // body masih berupa Buffer
        req.rawBody = body; // simpan di req.rawBody
        done(null, body); // body tetap diproses normal (Fastify bisa parse JSON juga)
    });
    fastify.post("/webhook/deploy", async (req, reply) => {
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) {
            return reply.status(401).send({ error: "No signature" });
        }
        // body raw dari request
        const body = req.rawBody; // pastikan fastify-plugin raw-body diaktifkan
        if (!body) {
            return reply.status(400).send({ error: "Missing raw body" });
        }
        // generate HMAC dari body
        const hmac = crypto_1.default.createHmac('sha256', GITHUB_SECRET);
        hmac.update(body);
        const digest = `sha256=${hmac.digest('hex')}`;
        if (!crypto_1.default.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))) {
            return reply.status(401).send({ error: "Invalid signature" });
        }
        // Jalankan deploy
        (0, child_process_1.exec)("cd /var/www/marketplaceservice && ./deploy.sh", (err, stdout, stderr) => {
            if (err)
                console.error(`Deploy error: ${stderr}`);
        });
        return reply.send({ status: "Deploy triggered ✅" });
    });
}
