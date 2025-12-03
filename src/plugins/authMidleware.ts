import { Prisma, PrismaClient } from "@prisma/client";
import { DefaultArgs } from "@prisma/client/runtime/library";
import { FastifyReply, FastifyRequest } from "fastify";
import { logger } from "src/utils/logger";
import { verifyToken } from "src/utils/token";
import { prisma } from "./prisma";

export const authMidleware = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.headers.authorization) {
        try {
            const bearerToken = req.headers.authorization.replace("Bearer ", "")
            const verify = await prisma.loginSession.findFirstOrThrow({ where: { jwtToken: bearerToken } })
            const user = await prisma.user.findUniqueOrThrow({
                where: { id: verify.userId }, select: {
                    id: true,
                    email: true,
                    displayName: true,
                    loginProvider: true,
                    role: true,
                    createdAt: true,
                    updatedAt: true,
                }
            })
            req.user = user as any
        } catch (error) {
            logger.error(error)
            reply.code(401).send({ message: 'Invalid access token' });
        }
    } else {
        logger.error('Tidak ada token')
        reply.code(401).send({ message: 'Invalid access token' });
    }
}