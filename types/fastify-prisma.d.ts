
import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'



type FastInstance = FastifyInstance & {
    prisma: PrismaClient;

}
declare module 'fastify' {
    interface FastifyRequest {
        user?: {
            id: string;
            email: string;
            name: string;
            role: 'buyer' | 'admin' | 'seller';
            [key: string]: string;
        }
    }
}