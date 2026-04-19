import { prisma } from "../plugins/prisma";
import { verifyToken } from "./token";
import Redis from "ioredis";

// Gunakan koneksi Redis langsung (bukan lewat fastify instance)
const redis = new Redis({
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
});

const SESSION_TTL = 300; // 5 menit

export async function getUserFromAccessToken(authorization?: string) {
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  const bearerToken = authorization.replace("Bearer ", "").trim();

  verifyToken(bearerToken);

  // Buat cache key dari token (hash pendek untuk keamanan)
  const cacheKey = `auth:session:${bearerToken.slice(-32)}`;

  // Cek cache dulu
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // Cache miss → query DB
  const session = await prisma.loginSession.findFirst({
    where: { jwtToken: bearerToken },
  });

  if (!session) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      loginProvider: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!user) return null;

  // Simpan ke cache
  await redis.setex(cacheKey, SESSION_TTL, JSON.stringify(user));

  return user;
}

export function ensureAdmin(user: { role?: string | null } | undefined | null) {
  return user?.role === "admin";
}

// Tambahkan di auth.ts
export async function invalidateSessionCache(bearerToken: string) {
  const cacheKey = `auth:session:${bearerToken.slice(-32)}`;
  await redis.del(cacheKey);
}
