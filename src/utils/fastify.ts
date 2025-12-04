import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client';

export type FastInstance = FastifyInstance & {
    prisma: PrismaClient
};

export const slugify = (text: string) => {
    return text
        .toString()
        .normalize("NFD") // hilangkan aksen/diacritics
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-") // selain huruf/angka = "-"
        .replace(/^-+|-+$/g, "") // trim "-"
}
