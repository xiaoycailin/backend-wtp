"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertBigIntAndDate = void 0;
exports.default = productRoutes;
const authMiddleware_1 = require("../plugins/authMiddleware");
const fastify_1 = require("../utils/fastify");
const activity_log_1 = require("../utils/activity-log");
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
// Helper invalidasi semua cache products
async function invalidateProductCache(fastify, productId, slug) {
    const keys = ["products:list:public"]; // selalu invalidasi list
    if (productId)
        keys.push(`products:detail:${productId}`);
    if (slug)
        keys.push(`products:detail:${slug}`);
    await fastify.cache.del(keys);
}
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
            const isPublic = user?.role === "buyer" || !user;
            // Admin/seller tidak di-cache (bisa lihat semua status)
            if (!isPublic) {
                const where = {
                    OR: [{ id: dynamic }, { slug: dynamic }],
                };
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
            }
            // Public: gunakan cache
            const cacheKey = `products:detail:${dynamic}`;
            const cached = await fastify.cache.get(cacheKey);
            if (cached)
                return reply.send(cached);
            const product = await fastify.prisma.products.findFirst({
                where: {
                    OR: [{ id: dynamic }, { slug: dynamic }],
                    status: { in: ["PUBLISHED", "AVAILABLE", "SOLD"] },
                },
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
            const result = (0, exports.convertBigIntAndDate)(product);
            await fastify.cache.set(cacheKey, result, 300); // TTL 5 menit
            return reply.send(result);
        },
    });
    // ===========================
    // LIST PRODUCTS
    // ===========================
    fastify.get("/products/list", {
        preHandler: authMiddleware_1.optionalAuthMiddleware,
        handler: async (req, reply) => {
            const user = req.user;
            const isPublic = user?.role === "buyer" || !user;
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
            if (category)
                where.categoryId = category.trim();
            if (sub)
                where.subCategoryId = sub.trim();
            if (status)
                where.status = status;
            if (id)
                where.id = id;
            if (isPublic) {
                where.status = { in: ["PUBLISHED", "AVAILABLE", "SOLD"] };
            }
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
            // Cache hanya untuk public tanpa search query
            // Request dengan filter/search terlalu bervariasi
            const canCache = isPublic && !q && !id && !status;
            const cacheKey = canCache
                ? `products:list:public:${category || "all"}:${sub || "all"}:${sort || "latest"}:${page}:${take}`
                : null;
            if (cacheKey) {
                const cached = await fastify.cache.get(cacheKey);
                if (cached)
                    return reply.send(cached);
            }
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
            const result = {
                total,
                page: Number(page),
                limit: take,
                items: items.map(exports.convertBigIntAndDate),
            };
            if (cacheKey) {
                await fastify.cache.set(cacheKey, result, 120); // TTL 2 menit
            }
            return reply.send(result);
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
                return reply
                    .status(400)
                    .send({ message: "discount harus lebih dari 0." });
            }
            if (normalizedDiscType === "percent" && normalizedDiscount > 100) {
                return reply
                    .status(400)
                    .send({ message: "discount percent maksimal 100." });
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
                include: { products: true },
            });
            // Invalidasi cache product yang kena flash sale
            await invalidateProductCache(fastify, productId, product.slug);
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
            // Admin only — tidak di-cache
            const flashsale = await fastify.prisma.flashSale.findMany({
                orderBy: { createdAt: "desc" },
                include: {
                    products: {
                        include: { subCategory: true },
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
                return reply
                    .status(400)
                    .send({ message: "flash sale id tidak valid." });
            }
            const existing = await fastify.prisma.flashSale.findUnique({
                where: { id: flashSaleId },
            });
            if (!existing) {
                return reply
                    .status(404)
                    .send({ message: "Flash sale tidak ditemukan." });
            }
            const data = {};
            if (discount !== undefined) {
                const normalizedDiscount = Number(discount);
                if (Number.isNaN(normalizedDiscount) || normalizedDiscount <= 0) {
                    return reply
                        .status(400)
                        .send({ message: "discount harus lebih dari 0." });
                }
                if ((discType ?? existing.discType) === "percent" &&
                    normalizedDiscount > 100) {
                    return reply
                        .status(400)
                        .send({ message: "discount percent maksimal 100." });
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
                    products: { include: { subCategory: true } },
                },
            });
            // Invalidasi cache product terkait
            if (existing.productId) {
                const product = await fastify.prisma.products.findUnique({
                    where: { id: existing.productId },
                    select: { slug: true },
                });
                await invalidateProductCache(fastify, existing.productId, product?.slug);
            }
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
                return reply
                    .status(400)
                    .send({ message: "flash sale id tidak valid." });
            }
            const existing = await fastify.prisma.flashSale.findUnique({
                where: { id: flashSaleId },
            });
            if (!existing) {
                return reply
                    .status(404)
                    .send({ message: "Flash sale tidak ditemukan." });
            }
            await fastify.prisma.flashSale.delete({ where: { id: flashSaleId } });
            // Invalidasi cache product terkait
            if (existing.productId) {
                const product = await fastify.prisma.products.findUnique({
                    where: { id: existing.productId },
                    select: { slug: true },
                });
                await invalidateProductCache(fastify, existing.productId, product?.slug);
            }
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
            return reply.send({ message: "Flash sale berhasil dihapus." });
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
                return reply
                    .status(404)
                    .send({ message: "Invalid subCategoryId provided." });
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
            // Invalidasi list cache
            await fastify.cache.del("products:list:public");
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
            // Invalidasi cache detail + list
            await invalidateProductCache(fastify, productId, product.slug);
            if (updateData.slug) {
                await fastify.cache.del(`products:detail:${updateData.slug}`);
            }
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
            await fastify.prisma.products.delete({ where: { id: productId } });
            // Invalidasi cache
            await invalidateProductCache(fastify, productId, product.slug);
            return reply.send({ message: "Product deleted successfully." });
        },
    });
    // ===========================
    // APPROVE PRODUCT
    // ===========================
    fastify.post("/products/approve", {
        preHandler: authMiddleware_1.authMiddleware,
        handler: async (req, reply) => {
            const user = req.user;
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
            // Produk baru published, invalidasi list
            await invalidateProductCache(fastify, productId, product.slug);
            return reply.send({
                message: "Product has been approved.",
                ...(0, exports.convertBigIntAndDate)(updated),
            });
        },
    });
}
