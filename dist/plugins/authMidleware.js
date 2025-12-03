"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMidleware = void 0;
const logger_1 = require("../utils/logger");
const prisma_1 = require("./prisma");
const authMidleware = async (req, reply) => {
    if (req.headers.authorization) {
        try {
            const bearerToken = req.headers.authorization.replace("Bearer ", "");
            const verify = await prisma_1.prisma.loginSession.findFirstOrThrow({ where: { jwtToken: bearerToken } });
            const user = await prisma_1.prisma.user.findUniqueOrThrow({
                where: { id: verify.userId }, select: {
                    id: true,
                    email: true,
                    displayName: true,
                    loginProvider: true,
                    role: true,
                    createdAt: true,
                    updatedAt: true,
                }
            });
            req.user = user;
        }
        catch (error) {
            logger_1.logger.error(error);
            reply.code(401).send({ message: 'Invalid access token' });
        }
    }
    else {
        logger_1.logger.error('Tidak ada token');
        reply.code(401).send({ message: 'Invalid access token' });
    }
};
exports.authMidleware = authMidleware;
