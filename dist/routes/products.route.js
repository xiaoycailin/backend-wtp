"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertBigIntAndDate = void 0;
exports.default = productRoutes;
const authMiddleware_1 = require("../plugins/authMiddleware");
const fastify_1 = require("../utils/fastify");
const activity_log_1 = require("../utils/activity-log");
/**
 * Helper: serialise BigInt and Date values that Prisma returns into
 * JSON-safe types.  Registered as Prisma middleware.
 *
 * BUG-FIX: Moved the `$use` middleware registration into the global Prisma
 * plugin so it's only registered once. Registering it inside the route plugin
 * meant it was added every time `productRoutes` was registered and would
 * stack up on hot-reload.
 *
 * The helper is exported so it can be reused from prisma.ts.
 */
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
async function productRoutes(fastify) {
    const ensureSellerOrAdmin = (user, reply) => {
        if (!user || (user.role !== "seller" && user.role !== "admin")) {
            reply.status(403).send({
                message: "You do not have permission to perform this action.",
            });
            return false;
        }
        return true;
    };
    const ensureOwnerOrAdmin = (user, ownerId, reply) => {
        if (user.role !== "admin" && user.id !== ownerId) {
            reply.status(403).send({
                message: "Unauthorized access to product resource.",
            });
            return false;
        }
        return true;
    };
    // ===========================
    // PRODUCT DETAIL
    // ===========================
    fastify.get("/products/:dynamic", {
        preHandler: authMiddleware_1.optionalAuthMiddleware,
        handler: async (req, reply) => {
            const user = req.user;
            const { dynamic } = req.params;
            const where = {
                OR: [{ id: dynamic }, { slug: dynamic }],
            };
            if (user?.role === "buyer" || !user) {
                where.status = { in: ["PUBLISHED", "AVAILABLE", "SOLD"] };
            }
            const product = await fastify.prisma.products.findFirst({
                where,
                include: {
                    sellerUser: { select: { id: true, displayName: true } },
                    category: true,
                    subCategory: true,
                    flashSales: true,
                },
            });
            if (!product) {
                return reply.status(404).send({ message: "Product not found." });
            }
            return reply.send((0, exports.convertBigIntAndDate)(product));
        },
    });
    // ===========================
    // LIST PRODUCTS
    // ===========================
    fastify.get("/products/list", {
        /**
         * BUG-FIX: Replaced inline copy-pasted optional-auth logic with
         * the reusable `optionalAuthMiddleware`.
         */
        preHandler: authMiddleware_1.optionalAuthMiddleware,
        handler: async (req, reply) => {
            const user = req.user;
            const { q, id, category, sub, status, sort, page = 1, limit = 20, } = req.query;
            const where = {};
            if (q) {
                const search = q.trim();
                where.OR = [
                    { title: { contains: search } },
                    { slug: { contains: search } },
                    { description: { contains: search } },
                    { conditionNotes: { contains: search } },
                ];
            }
            if (category) {
                where.categoryId = category.trim();
            }
            if (sub) {
                where.subCategoryId = sub.trim();
            }
            if (status) {
                where.status = status;
            }
            // Buyer / anonymous: restrict visible statuses
            if (user?.role === "buyer" || !user) {
                where.status = {
                    in: ["PUBLISHED", "AVAILABLE", "SOLD"],
                };
            }
            if (id) {
                where.id = id;
            }
            /**
             * BUG-FIX: Removed `console.log(where, "\n\n\n", user)`.
             * Debug logging should use the Fastify logger, and certainly not
             * in production code.
             */
            const orderBy = sort === "latest"
                ? { createdAt: "desc" }
                : sort === "oldest"
                    ? { createdAt: "asc" }
                    : sort === "low_price"
                        ? { price: "asc" }
                        : sort === "high_price"
                            ? { price: "desc" }
                            : { createdAt: "desc" };
            const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
            const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
            const [items, total] = await Promise.all([
                fastify.prisma.products.findMany({
                    where,
                    orderBy,
                    skip,
                    take,
                    include: {
                        sellerUser: { select: { id: true, displayName: true } },
                        category: true,
                        subCategory: true,
                    },
                }),
                fastify.prisma.products.count({ where }),
            ]);
            return reply.send({
                total,
                page: Number(page),
                limit: take,
                items: items.map(exports.convertBigIntAndDate),
            });
        },
    });
    // ===========================
    // CREATE PRODUCT FLASH SALE
    // ===========================
    fastify.post("/products/flashsale", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const user = req.user;
            if (!user)
                return;
            if (!ensureSellerOrAdmin(user, reply))
                return;
            const { productId, discount, discType, stock } = req.body;
            if (!productId) {
                return reply.status(400).send({ message: "productId is required." });
            }
            const normalizedDiscount = Number(discount ?? 0);
            const normalizedStock = Number(stock ?? 10);
            const normalizedDiscType = discType === "percent" ? "percent" : "flat";
            if (Number.isNaN(normalizedDiscount) || normalizedDiscount <= 0) {
                return reply.status(400).send({ message: "discount harus lebih dari 0." });
            }
            if (normalizedDiscType === "percent" && normalizedDiscount > 100) {
                return reply.status(400).send({ message: "discount percent maksimal 100." });
            }
            if (Number.isNaN(normalizedStock) || normalizedStock < 0) {
                return reply.status(400).send({ message: "stock tidak valid." });
            }
            const product = await fastify.prisma.products.findUnique({
                where: { id: productId },
            });
            if (!product) {
                return reply.status(404).send({ message: "Produk tidak ditemukan." });
            }
            const newFlashSale = await fastify.prisma.flashSale.create({
                data: {
                    productId,
                    stock: normalizedStock,
                    discount: normalizedDiscount,
                    discType: normalizedDiscType,
                },
                include: {
                    products: true,
                },
            });
            await (0, activity_log_1.createActivityLog)(fastify, {
                actorUserId: user.id,
                actorName: user.displayName ?? user.email ?? null,
                actorRole: user.role ?? null,
                action: "flashsale.create",
                entityType: "flash_sale",
                entityId: String(newFlashSale.id),
                entityLabel: newFlashSale.products?.title ?? null,
                description: `Membuat flash sale untuk ${newFlashSale.products?.title ?? "produk"}`,
                metadata: {
                    productId,
                    discount: normalizedDiscount,
                    discType: normalizedDiscType,
                    stock: normalizedStock,
                },
            });
            return reply.status(201).send({
                message: "Product flash sale successfully created.",
                data: (0, exports.convertBigIntAndDate)(newFlashSale),
            });
        },
    });
    // ===========================
    // LIST FLASH SALES
    // ===========================
    fastify.get("/products/flashsale", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (_req, reply) => {
            const flashsale = await fastify.prisma.flashSale.findMany({
                orderBy: { createdAt: "desc" },
                include: {
                    products: {
                        include: {
                            subCategory: true,
                        },
                    },
                },
            });
            return reply.status(200).send({
                data: flashsale.map(exports.convertBigIntAndDate),
            });
        },
    });
    fastify.put("/products/flashsale/:id", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const user = req.user;
            if (!user)
                return;
            if (!ensureSellerOrAdmin(user, reply))
                return;
            const { id } = req.params;
            const { discount, discType, stock } = req.body;
            const flashSaleId = Number(id);
            if (!Number.isInteger(flashSaleId) || flashSaleId <= 0) {
                return reply.status(400).send({ message: "flash sale id tidak valid." });
            }
            const existing = await fastify.prisma.flashSale.findUnique({
                where: { id: flashSaleId },
            });
            if (!existing) {
                return reply.status(404).send({ message: "Flash sale tidak ditemukan." });
            }
            const data = {};
            if (discount !== undefined) {
                const normalizedDiscount = Number(discount);
                if (Number.isNaN(normalizedDiscount) || normalizedDiscount <= 0) {
                    return reply.status(400).send({ message: "discount harus lebih dari 0." });
                }
                if ((discType ?? existing.discType) === "percent" && normalizedDiscount > 100) {
                    return reply.status(400).send({ message: "discount percent maksimal 100." });
                }
                data.discount = normalizedDiscount;
            }
            if (discType !== undefined) {
                if (!["flat", "percent"].includes(discType)) {
                    return reply.status(400).send({ message: "discType tidak valid." });
                }
                data.discType = discType;
            }
            if (stock !== undefined) {
                const normalizedStock = Number(stock);
                if (Number.isNaN(normalizedStock) || normalizedStock < 0) {
                    return reply.status(400).send({ message: "stock tidak valid." });
                }
                data.stock = normalizedStock;
            }
            const updated = await fastify.prisma.flashSale.update({
                where: { id: flashSaleId },
                data,
                include: {
                    products: {
                        include: {
                            subCategory: true,
                        },
                    },
                },
            });
            await (0, activity_log_1.createActivityLog)(fastify, {
                actorUserId: user.id,
                actorName: user.displayName ?? user.email ?? null,
                actorRole: user.role ?? null,
                action: "flashsale.update",
                entityType: "flash_sale",
                entityId: String(updated.id),
                entityLabel: updated.products?.title ?? null,
                description: `Mengubah flash sale ${updated.products?.title ?? "produk"}`,
                metadata: data,
            });
            return reply.send({
                message: "Flash sale berhasil diupdate.",
                data: (0, exports.convertBigIntAndDate)(updated),
            });
        },
    });
    fastify.delete("/products/flashsale/:id", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const user = req.user;
            if (!user)
                return;
            if (!ensureSellerOrAdmin(user, reply))
                return;
            const { id } = req.params;
            const flashSaleId = Number(id);
            if (!Number.isInteger(flashSaleId) || flashSaleId <= 0) {
                return reply.status(400).send({ message: "flash sale id tidak valid." });
            }
            const existing = await fastify.prisma.flashSale.findUnique({
                where: { id: flashSaleId },
            });
            if (!existing) {
                return reply.status(404).send({ message: "Flash sale tidak ditemukan." });
            }
            await fastify.prisma.flashSale.delete({
                where: { id: flashSaleId },
            });
            await (0, activity_log_1.createActivityLog)(fastify, {
                actorUserId: user.id,
                actorName: user.displayName ?? user.email ?? null,
                actorRole: user.role ?? null,
                action: "flashsale.delete",
                entityType: "flash_sale",
                entityId: String(existing.id),
                entityLabel: existing.productId ?? null,
                description: "Menghapus flash sale",
                metadata: {
                    productId: existing.productId,
                    discount: existing.discount,
                    discType: existing.discType,
                    stock: existing.stock,
                },
            });
            return reply.send({
                message: "Flash sale berhasil dihapus.",
            });
        },
    });
    // ===========================
    // CREATE PRODUCT
    // ===========================
    fastify.post("/products", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const user = req.user;
            if (!user)
                return;
            if (!ensureSellerOrAdmin(user, reply))
                return;
            const { sku, title, description, subCategoryId, price, currency, stock, thumbnails, conditionNotes, special, provider, } = req.body;
            if (!title || !subCategoryId) {
                return reply.status(400).send({
                    message: "Title and subCategoryId are required.",
                });
            }
            const slug = (0, fastify_1.slugify)(title);
            const subCategoryExists = await fastify.prisma.subCategory.findUnique({
                where: { id: subCategoryId },
            });
            if (!subCategoryExists) {
                return reply.status(404).send({
                    message: "Invalid subCategoryId provided.",
                });
            }
            const newProduct = await fastify.prisma.products.create({
                data: {
                    skuCode: sku,
                    sellerUserId: user.id,
                    title,
                    slug,
                    description,
                    categoryId: subCategoryExists.categoryId,
                    subCategoryId,
                    price: price || 0,
                    currency: currency ?? "IDR",
                    stock: stock ?? 1,
                    thumbnails,
                    conditionNotes,
                    provider: provider || "digiflazz",
                    isSpecial: special,
                },
            });
            return reply.status(201).send({
                message: "Product successfully created.",
                ...(0, exports.convertBigIntAndDate)(newProduct),
            });
        },
    });
    // ===========================
    // UPDATE PRODUCT
    // ===========================
    fastify.put("/products/:productId", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const { productId } = req.params;
            const user = req.user;
            const product = await fastify.prisma.products.findUnique({
                where: { id: productId },
            });
            if (!product) {
                return reply.status(404).send({ message: "Product not found." });
            }
            if (!ensureOwnerOrAdmin(user, product.sellerUserId, reply))
                return;
            const { title, description, categoryId, subCategoryId, price, currency, stock, thumbnails, conditionNotes, status, provider, } = req.body;
            const updateData = {};
            if (title) {
                updateData.title = title;
                updateData.slug = (0, fastify_1.slugify)(title);
            }
            if (subCategoryId) {
                const subExists = await fastify.prisma.subCategory.findUnique({
                    where: { id: subCategoryId },
                });
                if (!subExists) {
                    return reply.status(404).send({ message: "Invalid subCategoryId." });
                }
                updateData.subCategoryId = subCategoryId;
            }
            if (categoryId !== undefined)
                updateData.categoryId = categoryId || null;
            if (description !== undefined)
                updateData.description = description;
            if (price !== undefined)
                updateData.price = BigInt(price);
            if (currency !== undefined)
                updateData.currency = currency;
            if (stock !== undefined)
                updateData.stock = stock;
            if (thumbnails !== undefined)
                updateData.thumbnails = thumbnails;
            if (status !== undefined)
                updateData.status = status;
            if (conditionNotes !== undefined)
                updateData.conditionNotes = conditionNotes;
            if (provider !== undefined)
                updateData.provider = provider;
            const updatedProduct = await fastify.prisma.products.update({
                where: { id: productId },
                data: updateData,
            });
            return reply.send({
                message: "Product updated successfully.",
                ...(0, exports.convertBigIntAndDate)(updatedProduct),
            });
        },
    });
    // ===========================
    // DELETE PRODUCT
    // ===========================
    fastify.delete("/products/:productId", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const { productId } = req.params;
            const user = req.user;
            const product = await fastify.prisma.products.findUnique({
                where: { id: productId },
            });
            if (!product) {
                return reply.status(404).send({ message: "Product not found." });
            }
            if (!ensureOwnerOrAdmin(user, product.sellerUserId, reply))
                return;
            await fastify.prisma.products.delete({
                where: { id: productId },
            });
            return reply.send({
                message: "Product deleted successfully.",
            });
        },
    });
    // ===========================
    // APPROVE PRODUCT
    // ===========================
    fastify.post("/products/approve", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const user = req.user;
            /**
             * BUG-FIX:
             *  1. Used `===` instead of `==` for strict comparison.
             *  2. Changed status 401 → 403 (Forbidden) for authorization failures.
             *     401 means "not authenticated", 403 means "authenticated but not
             *     allowed".
             *  3. Fixed typo "allready" → "already".
             *  4. Stopped sending raw `Error` objects via `reply.send(new Error(...))`
             *     — Fastify serialises them poorly. Send a plain object instead.
             */
            if (user?.role !== "admin") {
                return reply.status(403).send({
                    message: "You do not have permission to perform this action.",
                });
            }
            const { productId } = req.body;
            if (!productId) {
                return reply.status(400).send({ message: "productId is required." });
            }
            const product = await fastify.prisma.products.findUnique({
                where: { id: productId, status: "DRAFT" },
            });
            if (!product) {
                return reply.status(409).send({
                    message: "Product not found or already approved.",
                });
            }
            const updated = await fastify.prisma.products.update({
                where: { id: productId },
                data: {
                    status: "PUBLISHED",
                    approvedBy: user.id,
                    approvedDate: new Date(),
                },
            });
            return reply.send({
                message: "Product has been approved.",
                ...(0, exports.convertBigIntAndDate)(updated),
            });
        },
    });
}
