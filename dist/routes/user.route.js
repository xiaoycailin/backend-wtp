"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertBigIntAndDate = void 0;
exports.default = userRoutes;
const authMiddleware_1 = require("../plugins/authMiddleware");
const user_schema_1 = require("../schemas/user.schema");
const hash_1 = require("../utils/hash");
const token_1 = require("../utils/token");
const convertBigIntAndDate = (val) => {
    if (typeof val === "bigint") {
        return val.toString();
    }
    else if (val instanceof Date) {
        return val.toISOString();
    }
    else if (Array.isArray(val)) {
        return val.map(exports.convertBigIntAndDate);
    }
    else if (val && typeof val === "object") {
        return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, (0, exports.convertBigIntAndDate)(v)]));
    }
    return val;
};
exports.convertBigIntAndDate = convertBigIntAndDate;
async function userRoutes(fastify) {
    const ensureAdmin = (user, reply) => {
        if (!user || user.role !== "admin") {
            reply.status(403).send({
                message: "You do not have permission to perform this action.",
            });
            return false;
        }
        return true;
    };
    // GET /users - list users (admin only)
    fastify.get("/users", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            if (!ensureAdmin(req.user, reply))
                return;
            const { q = "", role = "", page = "1", limit = "20", } = (req.query ?? {});
            const pageNumber = Math.max(Number(page) || 1, 1);
            const limitNumber = Math.min(Math.max(Number(limit) || 20, 1), 100);
            const skip = (pageNumber - 1) * limitNumber;
            const search = q.trim();
            const roleFilter = role.trim();
            const where = {
                AND: [
                    roleFilter ? { role: roleFilter } : {},
                    search
                        ? {
                            OR: [
                                { email: { contains: search } },
                                { displayName: { contains: search } },
                                { id: { contains: search } },
                            ],
                        }
                        : {},
                ],
            };
            const [items, total] = await Promise.all([
                fastify.prisma.user.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    skip,
                    take: limitNumber,
                    select: {
                        id: true,
                        email: true,
                        displayName: true,
                        loginProvider: true,
                        role: true,
                        createdAt: true,
                        updatedAt: true,
                        isSellerVerified: true,
                        emailVerified: true,
                        currency: true,
                        _count: {
                            select: {
                                products: true,
                                transactions: true,
                            },
                        },
                        // summary saldo/point
                        userBalances: {
                            select: {
                                type: true,
                                amount: true,
                            },
                        },
                    },
                }),
                fastify.prisma.user.count({ where }),
            ]);
            return reply.send({
                items: (0, exports.convertBigIntAndDate)(items),
                meta: {
                    total,
                    page: pageNumber,
                    limit: limitNumber,
                    totalPages: Math.max(Math.ceil(total / limitNumber), 1),
                },
            });
        },
    });
    // GET /users/self - current user profile + saldo & points
    fastify.get("/users/self", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const userId = req.user?.id;
            if (!userId) {
                return reply.status(401).send({ message: "Unauthorized" });
            }
            const user = await fastify.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    email: true,
                    displayName: true,
                    loginProvider: true,
                    role: true,
                    createdAt: true,
                    updatedAt: true,
                    isSellerVerified: true,
                    emailVerified: true,
                    currency: true,
                    userBalances: {
                        select: {
                            type: true,
                            amount: true,
                        },
                    },
                },
            });
            if (!user) {
                return reply.status(404).send({ message: "User not found" });
            }
            return reply.send((0, exports.convertBigIntAndDate)(user));
        },
    });
    // POST /users/wallet/topup
    fastify.post("/users/wallet/topup", {
        preHandler: authMiddleware_1.authMiddleware,
        schema: {
            body: {
                type: "object",
                required: ["amount"],
                properties: {
                    amount: { type: "number", minimum: 1 },
                    ref: { type: "string" },
                    meta: { type: "object" },
                },
            },
        },
        handler: async (req, reply) => {
            const user = req.user;
            if (!user?.id) {
                return reply.status(401).send({ message: "Unauthorized" });
            }
            const { amount, ref, meta } = req.body;
            if (!Number.isFinite(amount) || amount <= 0) {
                return reply
                    .status(400)
                    .send({ message: "Amount harus lebih besar dari 0." });
            }
            // konversi ke BigInt (minor unit, mis. rupiah)
            const amountMinor = BigInt(Math.round(amount));
            try {
                const result = await fastify.prisma.$transaction(async (tx) => {
                    // pastikan userBalance WALLET ada
                    const existingBalance = await tx.userBalance.findFirst({
                        where: {
                            userId: user.id,
                            type: "WALLET",
                        },
                    });
                    if (!existingBalance) {
                        // kalau belum ada, buat 0 dulu
                        await tx.userBalance.create({
                            data: {
                                userId: user.id,
                                type: "WALLET",
                                amount: BigInt(0),
                            },
                        });
                    }
                    // catat entry topup di MoneyEntry
                    const entry = await tx.moneyEntry.create({
                        data: {
                            userId: user.id,
                            amount: amountMinor, // + kredit
                            ref,
                            meta,
                        },
                    });
                    // update saldo wallet (increment)
                    const balance = await tx.userBalance.update({
                        where: {
                            userId_type: {
                                userId: user.id,
                                type: "WALLET",
                            },
                        },
                        data: {
                            amount: {
                                increment: amountMinor,
                            },
                        },
                    });
                    return { balance, entry };
                });
                return reply.status(201).send({
                    message: "Topup berhasil.",
                    balance: result.balance,
                    entry: result.entry,
                });
            }
            catch (err) {
                req.log.error({ err }, "Wallet topup failed");
                return reply
                    .status(500)
                    .send({ message: "Terjadi kesalahan saat topup saldo." });
            }
        },
    });
    // POST /users/auth/logout
    fastify.post("/users/auth/logout", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const header = req.headers.authorization;
            if (!header?.startsWith("Bearer ")) {
                return reply.status(400).send({ message: "Invalid access token" });
            }
            const bearerToken = header.replace("Bearer ", "").trim();
            await fastify.prisma.loginSession.deleteMany({
                where: { jwtToken: bearerToken },
            });
            return reply.send({ message: "Logout successful." });
        },
    });
    // GET /users/auth/logout (opsional)
    fastify.get("/users/auth/logout", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const header = req.headers.authorization;
            if (!header?.startsWith("Bearer ")) {
                return reply.status(400).send({ message: "Invalid access token" });
            }
            const bearerToken = header.replace("Bearer ", "").trim();
            await fastify.prisma.loginSession.deleteMany({
                where: { jwtToken: bearerToken },
            });
            return reply.send({ message: "Logout successful." });
        },
    });
    // POST /users/auth/register
    fastify.post("/users/auth/register", {
        schema: {
            body: user_schema_1.createUserSchema,
        },
        handler: async (req, reply) => {
            const body = req.body;
            let passwordHash;
            if (body.password) {
                passwordHash = await (0, hash_1.hashPassword)(body.password);
            }
            const ipList = [req.ip, ...(req.ips || [])].filter(Boolean);
            const ipaddr = ipList.join(",");
            try {
                const user = await fastify.prisma.user.create({
                    data: {
                        email: body.email,
                        displayName: body.displayName,
                        passwordHash,
                        loginProvider: body.loginProvider,
                        role: body.role,
                        // initial balances
                        userBalances: {
                            create: [
                                {
                                    type: "WALLET",
                                    amount: BigInt(0),
                                },
                                {
                                    type: "POINTS",
                                    amount: BigInt(0),
                                },
                            ],
                        },
                    },
                    include: {
                        userBalances: true,
                    },
                });
                const userToken = (0, token_1.createToken)({
                    id: user.id,
                    displayName: user.displayName,
                    email: user.email,
                    role: user.role,
                });
                const session = await fastify.prisma.loginSession.create({
                    data: {
                        userId: user.id,
                        user_agent: req.headers["user-agent"],
                        ip_addr: ipaddr,
                        jwtToken: userToken,
                        lastSeenAt: new Date(),
                    },
                });
                return reply.status(201).send(session);
            }
            catch (error) {
                if (error.code === "P2002") {
                    return reply.status(409).send({
                        message: "Mohon gunakan email lain yang belum pernah digunakan sebelumnya.",
                    });
                }
                throw error;
            }
        },
    });
    // POST /users/auth/login
    fastify.post("/users/auth/login", {
        schema: {
            body: user_schema_1.createUserLoginSchema,
        },
        handler: async (req, reply) => {
            const ipList = [req.ip, ...(req.ips || [])].filter(Boolean);
            const ipaddr = ipList.join(",");
            const body = req.body;
            const userByEmail = await fastify.prisma.user.findFirst({
                where: { email: body.email },
            });
            if (!userByEmail || !userByEmail.passwordHash) {
                return reply.status(401).send({
                    message: "Email atau password yang Anda masukan salah.",
                });
            }
            const isValid = await (0, hash_1.verifyPassword)(body.password, userByEmail.passwordHash);
            if (!isValid) {
                return reply.status(401).send({
                    message: "Email atau password yang Anda masukan salah.",
                });
            }
            const userToken = (0, token_1.createToken)({
                id: userByEmail.id,
                displayName: userByEmail.displayName,
                email: userByEmail.email,
                role: userByEmail.role,
            });
            const session = await fastify.prisma.loginSession.upsert({
                where: { userId: userByEmail.id },
                update: {
                    user_agent: req.headers["user-agent"],
                    ip_addr: ipaddr,
                    jwtToken: userToken,
                    lastSeenAt: new Date(),
                },
                create: {
                    userId: userByEmail.id,
                    user_agent: req.headers["user-agent"],
                    ip_addr: ipaddr,
                    jwtToken: userToken,
                    lastSeenAt: new Date(),
                },
            });
            return reply.send(session);
        },
    });
    // POST /admin/users/:id/init-balances
    fastify.post("/users/:id/init-balances", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const currentUser = req.user;
            if (!currentUser || currentUser.role !== "admin") {
                return reply.status(403).send({
                    message: "You do not have permission to perform this action.",
                });
            }
            const userId = req.params.id;
            const user = await fastify.prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, email: true },
            });
            if (!user) {
                return reply.status(404).send({ message: "User not found." });
            }
            try {
                const result = await fastify.prisma.$transaction(async (tx) => {
                    // cek existing balances
                    const existingBalances = await tx.userBalance.findMany({
                        where: {
                            userId: userId,
                        },
                    });
                    const hasWallet = existingBalances.some((b) => b.type === "WALLET");
                    const hasPoints = existingBalances.some((b) => b.type === "POINTS");
                    const creates = [];
                    if (!hasWallet) {
                        creates.push(tx.userBalance.create({
                            data: {
                                userId,
                                type: "WALLET",
                                amount: BigInt(0),
                            },
                        }));
                    }
                    if (!hasPoints) {
                        creates.push(tx.userBalance.create({
                            data: {
                                userId,
                                type: "POINTS",
                                amount: BigInt(0),
                            },
                        }));
                    }
                    if (creates.length > 0) {
                        await Promise.all(creates);
                    }
                    const balancesAfter = await tx.userBalance.findMany({
                        where: { userId },
                        select: {
                            type: true,
                            amount: true,
                        },
                    });
                    return balancesAfter;
                });
                return reply.send({
                    message: "User balances initialized successfully.",
                    userId,
                    balances: (0, exports.convertBigIntAndDate)(result),
                });
            }
            catch (err) {
                req.log.error({ err }, "Init user balances failed");
                return reply.status(500).send({
                    message: "Terjadi kesalahan saat menginisialisasi saldo user.",
                });
            }
        },
    });
}
