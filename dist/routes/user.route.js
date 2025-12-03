"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = userRoutes;
const authMidleware_1 = require("../plugins/authMidleware");
const user_schema_1 = require("../schemas/user.schema");
const hash_1 = require("../utils/hash");
const token_1 = require("../utils/token");
async function userRoutes(fastify) {
    fastify.get('/users/self', {
        preHandler: authMidleware_1.authMidleware,
        handler: async (req, reply) => {
            // TODO: patch response
            reply.send(req.user);
        }
    });
    fastify.post("/users/auth/register", {
        schema: {
            body: user_schema_1.createUserSchema,
        },
        handler: async (req, reply) => {
            const body = req.body;
            if (body.password)
                body.password = await (0, hash_1.hashPassword)(body.password);
            body.passwordHash = body.password;
            delete body.password;
            try {
                const user = await fastify.prisma.user.create({
                    data: body,
                });
                reply.send(user);
            }
            catch (error) {
                const stack = error.stack;
                if (stack.includes("Unique constraint failed on the constraint: `User_email_key`")) {
                    reply.send({
                        message: "Mohon gunakan email lain yang belum pernah digunakan sebelumnya.",
                    });
                }
            }
        },
    });
    fastify.post("/users/auth/login", {
        schema: {
            body: user_schema_1.createUserLoginSchema,
        },
        handler: async (req, reply) => {
            const ipaddr = req.ip + ", " + req.ips?.join(",");
            const body = req.body;
            if (!body.password && !body.email) {
                return reply.send({
                    message: "Harap lengkapi kolom Email dan Password."
                });
            }
            else {
                try {
                    const userByEmail = await fastify.prisma.user.findFirst({
                        where: {
                            email: body.email,
                        }
                    });
                    if (userByEmail) {
                        const hasVerify = await (0, hash_1.verifyPassword)(body.password, userByEmail.passwordHash);
                        if (hasVerify) {
                            // create token and put to table loginSession
                            const userToken = (0, token_1.createToken)({
                                id: userByEmail.id,
                                displayName: userByEmail.displayName,
                                email: userByEmail.email,
                                role: userByEmail.role,
                            });
                            // put token to database
                            const fLoginSession = await fastify.prisma.loginSession.findFirst({ where: { userId: userByEmail.id } });
                            if (fLoginSession) {
                                // update token yang sudah ada
                                const updateDataSession = await fastify.prisma.loginSession.update({
                                    where: { id: fLoginSession.id, userId: userByEmail.id },
                                    data: {
                                        user_agent: req.headers['user-agent'],
                                        ip_addr: ipaddr,
                                        jwtToken: userToken,
                                        lastSeenAt: new Date()
                                    }
                                });
                                reply.send(updateDataSession);
                            }
                            else {
                                try {
                                    const createDataSession = await fastify.prisma.loginSession.create({
                                        data: {
                                            userId: userByEmail.id,
                                            user_agent: req.headers['user-agent'],
                                            ip_addr: ipaddr,
                                            jwtToken: userToken,
                                            lastSeenAt: new Date()
                                        }
                                    });
                                    reply.send(createDataSession);
                                }
                                catch (error) {
                                    reply.send(error);
                                }
                            }
                        }
                        else {
                            reply.send({ message: "Email atau password yang Anda masukan salah." });
                        }
                    }
                    else {
                        reply.send({
                            message: "Email atau password yang Anda masukan salah."
                        });
                    }
                }
                catch (error) {
                    const stack = error.stack;
                    if (stack.includes("Unique constraint failed on the constraint: `User_email_key`")) {
                        reply.send({
                            message: stack,
                        });
                    }
                }
            }
        },
    });
}
