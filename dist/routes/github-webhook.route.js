"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = githubWebhook;
const child_process_1 = require("child_process");
async function githubWebhook(fastify) {
    fastify.post("/webhook/deploy", async (req, reply) => {
        (0, child_process_1.exec)("cd /var/www/marketplaceservice && ./deploy.sh", (err, stdout, stderr) => {
            if (err)
                console.error(`Deploy error: ${stderr}`);
        });
        return reply.send({ status: "Deploy triggered" });
    });
}
