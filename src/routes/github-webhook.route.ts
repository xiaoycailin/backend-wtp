import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { exec } from 'child_process';
import crypto from 'crypto';
import { logger } from 'utils/logger'; // sesuaikan loggermu


// Repository dan branch yang diizinkan
const ALLOWED_REPO = 'aiden2209-dev/marketplaceservice';
const ALLOWED_BRANCH = 'refs/heads/main';

export default async function githubWebhook(fastify: FastifyInstance) {
    fastify.post('/webhook/deploy', async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            const signature = req.headers['x-hub-signature-256'] as string | undefined;
            const event = req.headers['x-github-event'] as string | undefined;

            if (!signature) return reply.status(401).send({ error: 'No signature' });
            if (!event || event !== 'push') return reply.status(400).send({ error: 'Invalid event type' });

            const payload: any = req.body
            // Validasi repo dan branch
            if (payload.repository?.full_name !== ALLOWED_REPO) {
                return reply.status(403).send({ error: 'Unauthorized repository' });
            }
            if (payload.ref !== ALLOWED_BRANCH) {
                return reply.status(403).send({ error: 'Push is not to main branch' });
            }

            const msg = `Deploy triggered for repo: ${payload.repository?.name}, branch: ${payload.ref}, by: ${payload.pusher?.name}`
            logger.info(msg);

            // Jalankan deploy script
            exec('cd /var/www/marketplaceservice && ./deploy.sh', (err, stdout, stderr) => {
                if (err) logger.error(`Deploy error: ${stderr}`);
                else logger.info(`Deploy output: ${stdout}`);
            });

            return reply.send({ status: 'Deploy triggered ✅', message: msg });
        } catch (err) {
            logger.error('Webhook processing error:', err);
            return reply.status(500).send({ error: 'Internal server error' });
        }
    });
}
