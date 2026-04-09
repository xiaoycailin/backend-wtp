"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = githubWebhook;
const child_process_1 = require("child_process");
const crypto_1 = __importDefault(require("crypto"));
const logger_1 = require("../utils/logger");
const system_log_1 = require("../utils/system-log");
const ALLOWED_REPO = process.env.GITHUB_ALLOWED_REPO || "aiden2209-dev/marketplaceservice";
const ALLOWED_BRANCH = process.env.GITHUB_ALLOWED_BRANCH || "refs/heads/main";
const DEPLOY_COMMAND = process.env.GITHUB_DEPLOY_COMMAND;
function verifyGithubSignature(payload, signatureHeader, secret) {
    const expected = "sha256=" +
        crypto_1.default.createHmac("sha256", secret).update(payload).digest("hex");
    if (expected.length !== signatureHeader.length) {
        return false;
    }
    return crypto_1.default.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
async function githubWebhook(fastify) {
    fastify.post("/webhook/deploy", async (req, reply) => {
        try {
            const signature = req.headers["x-hub-signature-256"];
            const event = req.headers["x-github-event"];
            if (!signature) {
                return reply.status(401).send({ error: "No signature" });
            }
            if (event !== "push") {
                return reply.status(400).send({ error: "Invalid event type" });
            }
            const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
            if (!webhookSecret) {
                logger_1.logger.error("GITHUB_WEBHOOK_SECRET env variable is missing");
                return reply.status(500).send({ error: "Server configuration error" });
            }
            if (!DEPLOY_COMMAND) {
                return reply.status(503).send({ error: "Deploy command is not configured" });
            }
            const rawBody = req.rawBody ?? (typeof req.body === "string" ? req.body : JSON.stringify(req.body));
            if (!verifyGithubSignature(rawBody, signature, webhookSecret)) {
                return reply.status(401).send({ error: "Invalid signature" });
            }
            const payload = req.body;
            if (payload.repository?.full_name !== ALLOWED_REPO) {
                return reply.status(403).send({ error: "Unauthorized repository" });
            }
            if (payload.ref !== ALLOWED_BRANCH) {
                return reply.status(403).send({ error: "Push is not to allowed branch" });
            }
            const message = `Deploy triggered for repo: ${payload.repository?.name}, branch: ${payload.ref}, by: ${payload.pusher?.name}`;
            logger_1.logger.info(message);
            (0, child_process_1.exec)(DEPLOY_COMMAND, (err, stdout, stderr) => {
                if (err) {
                    logger_1.logger.error({ err, stderr }, "Deploy command failed");
                    return;
                }
                logger_1.logger.info({ stdout }, "Deploy command completed");
            });
            return reply.send({
                status: "Deploy triggered",
                time: new Date().toISOString(),
                message,
            });
        }
        catch (err) {
            logger_1.logger.error({ err }, "Webhook processing error");
            await (0, system_log_1.createSystemLog)(fastify, {
                type: "app_error",
                source: "github_webhook.deploy",
                message: err?.message ?? "Webhook processing error",
                statusCode: err?.statusCode ?? 500,
                method: req.method,
                url: req.url,
                requestPayload: {
                    headers: {
                        "x-github-event": req.headers["x-github-event"],
                        "x-hub-signature-256": req.headers["x-hub-signature-256"] ? "[redacted]" : null,
                    },
                    body: req.body,
                },
                errorStack: err?.stack ?? null,
            });
            return reply.status(500).send({ error: "Internal server error" });
        }
    });
}
