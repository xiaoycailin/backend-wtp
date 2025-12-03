import { exec } from 'child_process';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';

const GITHUB_SECRET = 'talonsecret2025'

export default async function githubWebhook(fastify: FastifyInstance) {

    fastify.addContentTypeParser('*', { parseAs: 'buffer' }, function (req, body, done) {
        // body masih berupa Buffer
        (req as any).rawBody = body; // simpan di req.rawBody
        done(null, body); // body tetap diproses normal (Fastify bisa parse JSON juga)
    });


    fastify.post("/webhook/deploy", async (req: FastifyRequest, reply: FastifyReply) => {
        const signature = req.headers['x-hub-signature-256'] as string | undefined;

        if (!signature) {
            return reply.status(401).send({ error: "No signature" });
        }

        // body raw dari request
        const body = (req as any).rawBody; // pastikan fastify-plugin raw-body diaktifkan
        if (!body) {
            return reply.status(400).send({ error: "Missing raw body" });
        }

        // generate HMAC dari body
        const hmac = crypto.createHmac('sha256', GITHUB_SECRET);
        hmac.update(body);
        const digest = `sha256=${hmac.digest('hex')}`;

        if (!crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))) {
            return reply.status(401).send({ error: "Invalid signature" });
        }

        // Jalankan deploy
        exec("cd /var/www/marketplaceservice && ./deploy.sh", (err, stdout, stderr) => {
            if (err) console.error(`Deploy error: ${stderr}`);
        });

        return reply.send({ status: "Deploy triggered ✅" });
    });
}
