import { FastInstance } from 'fastify-prisma'
import { authMidleware } from 'src/plugins/authMidleware';
import { UserFieldPayload, createUserLoginSchema, createUserSchema } from 'src/schemas/user.schema';
import { hashPassword, verifyPassword } from 'src/utils/hash';
import { logger } from 'src/utils/logger';
import { createToken } from 'src/utils/token';



export default async function userRoutes(fastify: FastInstance) {
    fastify.get('/users/self', {
        preHandler: authMidleware,
        handler: async (req, reply) => {
            // TODO: patch response
            reply.send(req.user)
        }
    })

    fastify.post("/users/auth/register", {
        schema: {
            body: createUserSchema,
        },
        handler: async (req, reply) => {
            const body = req.body as UserFieldPayload;
            if (body.password) body.password = await hashPassword(body.password)
            body.passwordHash = body.password
            delete body.password
            try {
                const user = await fastify.prisma.user.create({
                    data: body,
                })
                reply.send(user)
            } catch (error: any) {
                const stack: string = error.stack

                if (stack.includes("Unique constraint failed on the constraint: `User_email_key`")) {
                    reply.send({
                        message: "Mohon gunakan email lain yang belum pernah digunakan sebelumnya.",
                    })
                }
            }
        },
    })

    fastify.post("/users/auth/login", {
        schema: {
            body: createUserLoginSchema,
        },
        handler: async (req, reply) => {
            const body = req.body as UserFieldPayload;
            if (!body.password && !body.email) {
                return reply.send({
                    message: "Harap lengkapi kolom Email dan Password."
                })
            } else {
                try {
                    const userByEmail = await fastify.prisma.user.findFirst({
                        where: {
                            email: body.email,
                        }
                    })

                    if (userByEmail) {
                        const hasVerify = await verifyPassword(body.password!, userByEmail.passwordHash!)
                        if (hasVerify) {
                            // create token and put to table loginSession
                            const userToken = createToken({
                                id: userByEmail.id,
                                displayName: userByEmail.displayName,
                                email: userByEmail.email,
                                role: userByEmail.role,
                            })


                            // put token to database
                            const fLoginSession = await fastify.prisma.loginSession.findFirst({ where: { userId: userByEmail.id } })


                            if (fLoginSession) {
                                // update token yang sudah ada
                                const updateDataSession = await fastify.prisma.loginSession.update({
                                    where: { id: fLoginSession.id, userId: userByEmail.id },
                                    data: {
                                        user_agent: req.headers['user-agent'],
                                        ip_addr: req.ips?.join(","),
                                        jwtToken: userToken,
                                        lastSeenAt: new Date()
                                    }
                                })
                                reply.send(updateDataSession)
                            } else {
                                try {
                                    const createDataSession = await fastify.prisma.loginSession.create({
                                        data: {
                                            userId: userByEmail.id,
                                            user_agent: req.headers['user-agent'],
                                            ip_addr: req.ips?.join(","),
                                            jwtToken: userToken,
                                            lastSeenAt: new Date()
                                        }
                                    })
                                    reply.send(createDataSession)
                                } catch (error) {
                                    reply.send(error)
                                }
                            }

                        } else {
                            reply.send({ message: "Email atau password yang Anda masukan salah." })
                        }
                    } else {
                        reply.send({
                            message: "Email atau password yang Anda masukan salah."
                        })
                    }
                } catch (error: any) {
                    const stack: string = error.stack

                    if (stack.includes("Unique constraint failed on the constraint: `User_email_key`")) {
                        reply.send({
                            message: stack,
                        })
                    }
                }
            }
        },
    })
}
