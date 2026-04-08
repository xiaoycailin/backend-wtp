import { prisma } from "../plugins/prisma";
import { verifyToken } from "./token";

export async function getUserFromAccessToken(authorization?: string) {
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return null;
  }

  const bearerToken = authorization.replace("Bearer ", "").trim();

  verifyToken(bearerToken);

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

  return user ?? null;
}

export function ensureAdmin(user: { role?: string | null } | undefined | null) {
  return user?.role === "admin";
}
