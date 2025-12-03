import { exec } from 'child_process';
import { FastifyInstance } from 'fastify'

export default async function githubWebhook(fastify: FastifyInstance) {
    fastify.post("/webhook/deploy", async (req, reply) => {
        exec("cd /var/www/marketplaceservice && ./deploy.sh", (err, stdout, stderr) => {
            if (err) console.error(`Deploy error: ${stderr}`);
        });

        return reply.send({ status: "Deploy triggered" });
    });

}
