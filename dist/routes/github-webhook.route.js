"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = githubWebhook;
const child_process_1 = require("child_process");
const logger_1 = require("utils/logger"); // sesuaikan loggermu
// Repository dan branch yang diizinkan
const ALLOWED_REPO = 'aiden2209-dev/marketplaceservice';
const ALLOWED_BRANCH = 'refs/heads/main';
async function githubWebhook(fastify) {
    fastify.post('/webhook/deploy', async (req, reply) => {
        try {
            const signature = req.headers['x-hub-signature-256'];
            const event = req.headers['x-github-event'];
            if (!signature)
                return reply.status(401).send({ error: 'No signature' });
            if (!event || event !== 'push')
                return reply.status(400).send({ error: 'Invalid event type' });
            const payload = req.body;
            // Validasi repo dan branch
            if (payload.repository?.full_name !== ALLOWED_REPO) {
                return reply.status(403).send({ error: 'Unauthorized repository' });
            }
            if (payload.ref !== ALLOWED_BRANCH) {
                return reply.status(403).send({ error: 'Push is not to main branch' });
            }
            const msg = `Deploy triggered for repo: ${payload.repository?.name}, branch: ${payload.ref}, by: ${payload.pusher?.name}`;
            logger_1.logger.info(msg);
            // Jalankan deploy script
            (0, child_process_1.exec)('cd /var/www/marketplaceservice && ./deploy.sh', (err, stdout, stderr) => {
                if (err)
                    logger_1.logger.error(`Deploy error: ${stderr}`);
                else
                    logger_1.logger.info(`Deploy output: ${stdout}`);
            });
            return reply.send({ status: 'Deploy triggered ✅', message: msg });
        }
        catch (err) {
            logger_1.logger.error('Webhook processing error:', err);
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
