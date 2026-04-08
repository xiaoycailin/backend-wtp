import jwt from "jsonwebtoken";

/**
 * BUG-FIX: The fallback 'insecure-secret' means the app starts silently
 * without JWT_SECRET in .env, producing easily forgeable tokens.
 * Now throws at startup if the variable is missing.
 */
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET environment variable is required but was not set.",
  );
}

const EXPIRES_IN = "3d";

export type JwtPayload = {
  id: string;
  displayName?: string | null;
  email: string;
  role?: string | null;
};

export const createToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
};

export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
};
