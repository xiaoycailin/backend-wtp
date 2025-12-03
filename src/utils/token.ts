import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'insecure-secret'

const EXPIRES_IN = '3d'

export type JwtPayload = {
    id: string
    displayName?: string | null
    email: string
    role?: string | null
}

export const createToken = (payload: JwtPayload): string => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN })
}

export const verifyToken = (token: string): JwtPayload => {
    return jwt.verify(token, JWT_SECRET) as JwtPayload
}