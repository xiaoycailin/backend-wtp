"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = userRoutes;
const authMiddleware_1 = require("../plugins/authMiddleware");
const user_schema_1 = require("../schemas/user.schema");
const hash_1 = require("../utils/hash");
const token_1 = require("../utils/token");
async function userRoutes(fastify) {
    fastify.get("/users/self", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            reply.send(req.user);
        },
    });
    fastify.post("/users/auth/logout", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const header = req.headers.authorization;
            if (!header?.startsWith("Bearer ")) {
                return reply.status(400).send({ message: "Invalid access token" });
            }
            const bearerToken = header.replace("Bearer ", "").trim();
            await fastify.prisma.loginSession.deleteMany({
                where: { jwtToken: bearerToken },
            });
            return reply.send({ message: "Logout successful." });
        },
    });
    fastify.get("/users/auth/logout", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const header = req.headers.authorization;
            if (!header?.startsWith("Bearer ")) {
                return reply.status(400).send({ message: "Invalid access token" });
            }
            const bearerToken = header.replace("Bearer ", "").trim();
            await fastify.prisma.loginSession.deleteMany({
                where: { jwtToken: bearerToken },
            });
            return reply.send({ message: "Logout successful." });
        },
    });
    fastify.post("/users/auth/register", {
        schema: {
            body: user_schema_1.createUserSchema,
        },
        handler: async (req, reply) => {
            const body = req.body;
            let passwordHash;
            if (body.password) {
                passwordHash = await (0, hash_1.hashPassword)(body.password);
            }
            const ipList = [req.ip, ...(req.ips || [])].filter(Boolean);
            const ipaddr = ipList.join(",");
            try {
                const user = await fastify.prisma.user.create({
                    data: {
                        email: body.email,
                        displayName: body.displayName,
                        passwordHash,
                        loginProvider: body.loginProvider,
                        role: body.role,
                    },
                });
                const userToken = (0, token_1.createToken)({
                    id: user.id,
                    displayName: user.displayName,
                    email: user.email,
                    role: user.role,
                });
                const session = await fastify.prisma.loginSession.create({
                    data: {
                        userId: user.id,
                        user_agent: req.headers["user-agent"],
                        ip_addr: ipaddr,
                        jwtToken: userToken,
                        lastSeenAt: new Date(),
                    },
                });
                return reply.status(201).send(session);
            }
            catch (error) {
                if (error.code === "P2002") {
                    return reply.status(409).send({
                        message: "Mohon gunakan email lain yang belum pernah digunakan sebelumnya.",
                    });
                }
                throw error;
            }
        },
    });
    fastify.post("/users/auth/login", {
        schema: {
            body: user_schema_1.createUserLoginSchema,
        },
        handler: async (req, reply) => {
            const ipList = [req.ip, ...(req.ips || [])].filter(Boolean);
            const ipaddr = ipList.join(",");
            const body = req.body;
            const userByEmail = await fastify.prisma.user.findFirst({
                where: { email: body.email },
            });
            if (!userByEmail || !userByEmail.passwordHash) {
                return reply.status(401).send({
                    message: "Email atau password yang Anda masukan salah.",
                });
            }
            const isValid = await (0, hash_1.verifyPassword)(body.password, userByEmail.passwordHash);
            if (!isValid) {
                return reply.status(401).send({
                    message: "Email atau password yang Anda masukan salah.",
                });
            }
            const userToken = (0, token_1.createToken)({
                id: userByEmail.id,
                displayName: userByEmail.displayName,
                email: userByEmail.email,
                role: userByEmail.role,
            });
            const session = await fastify.prisma.loginSession.upsert({
                where: { userId: userByEmail.id },
                update: {
                    user_agent: req.headers["user-agent"],
                    ip_addr: ipaddr,
                    jwtToken: userToken,
                    lastSeenAt: new Date(),
                },
                create: {
                    userId: userByEmail.id,
                    user_agent: req.headers["user-agent"],
                    ip_addr: ipaddr,
                    jwtToken: userToken,
                    lastSeenAt: new Date(),
                },
            });
            return reply.send(session);
        },
    });
}
