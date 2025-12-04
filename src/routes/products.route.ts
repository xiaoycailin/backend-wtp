import { authMidleware } from "../plugins/authMidleware";
import { FastInstance, slugify } from "../utils/fastify";

export default async function productRoutes(fastify: FastInstance) {


    fastify.prisma.$use(async (params, next) => {
        const result = await next(params);

        const convert = (val: any): any => {
            if (typeof val === "bigint") {
                return val.toString();

            } else if (val instanceof Date) {
                return val.toISOString(); // fix Date
            } else if (Array.isArray(val)) {
                return val.map(convert);
            } else if (val && typeof val === "object") {
                return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, convert(v)]));
            }
            return val
        };

        return convert(result);
    });


    const ensureSellerOrAdmin = (user: any, reply: any) => {
        if (!user || (user.role !== "seller" && user.role !== "admin")) {
            reply.status(403).send({
                message: "You do not have permission to perform this action."
            });
            return false;
        }
        return true;
    };

    const ensureOwnerOrAdmin = (
        user: any,
        ownerId: string,
        reply: any
    ) => {
        if (user.role !== "admin" && user.id !== ownerId) {
            reply.status(403).send({
                message: "Unauthorized access to product resource."
            });
            return false;
        }
        return true;
    };



    fastify.get('/products', {
        handler: async (req, reply) => {
            const user = req.user;
            const { q, category, sub, status, sort, page = 1, limit = 20 } = req.query as any;

            const where: any = {};

            // Search filter
            if (q) {
                const search = q.trim();
                where.OR = [
                    { title: { contains: search } },
                    { slug: { contains: search } },
                    { description: { contains: search } },
                    { conditionNotes: { contains: search } }
                ];
            }

            // Category filter (ID only)
            if (category) {
                where.categoryId = category.trim();
            }

            // Sub-category filter (ID only)
            if (sub) {
                where.subCategoryId = sub.trim();
            }

            // Status filter from query
            if (status) {
                where.status = status;
            }

            // Buyer restrict status visibility
            if (user?.role === 'buyer') {
                where.status = {
                    in: ["PUBLISHED", "AVAILABLE", "SOLD"]
                };
            }

            // Sorting logic
            const orderBy: any =
                sort === "latest" ? { createdAt: "desc" } :
                    sort === "oldest" ? { createdAt: "asc" } :
                        sort === "low_price" ? { price: "asc" } :
                            sort === "high_price" ? { price: "desc" } :
                                { createdAt: "desc" }; // default

            // Pagination
            const take = Number(limit);
            const skip = (Number(page) - 1) * take;

            const [items, total] = await Promise.all([
                fastify.prisma.products.findMany({
                    where,
                    orderBy,
                    skip,
                    take,
                    include: {
                        sellerUser: { select: { id: true, displayName: true } },
                        category: true,
                        subCategory: true
                    }
                }),
                fastify.prisma.products.count({ where })
            ]);

            return reply.send({
                total,
                page: Number(page),
                limit: take,
                items
            });
        }
    });

    // ===========================
    // CREATE PRODUCT
    // ===========================
    fastify.post('/products', {
        preHandler: authMidleware,
        handler: async (req, reply) => {
            const user = req.user;
            if (!user) return
            if (!ensureSellerOrAdmin(user, reply)) return;

            const {
                title,
                description,
                subCategoryId,
                price,
                currency,
                stock,
                thumbnails,
                conditionNotes
            } = req.body as any;

            if (!title || !subCategoryId) {
                return reply.status(400).send({
                    message: "Title and subCategoryId are required."
                });
            }

            const slug = slugify(title);

            // Validate sub-category
            const subCategoryExists = await fastify.prisma.subCategory.findUnique({
                where: { id: subCategoryId }
            });
            if (!subCategoryExists) {
                return reply.status(404).send({
                    message: "Invalid subCategoryId provided."
                });
            }

            const newProduct = await fastify.prisma.products.create({
                data: {
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
                    conditionNotes
                }
            });

            return reply.status(201).send({
                message: "Product successfully created.",
                ...newProduct
            });
        }
    });

    // ===========================
    // UPDATE PRODUCT
    // ===========================
    fastify.put('/products/:productId', {
        preHandler: authMidleware,
        handler: async (req, reply) => {
            const { productId } = req.params as any;
            const user = req.user;

            const product = await fastify.prisma.products.findUnique({ where: { id: productId } });

            if (!product) {
                return reply.status(404).send({ message: "Product not found." });
            }

            if (!ensureOwnerOrAdmin(user, product.sellerUserId, reply)) return;

            const {
                title,
                description,
                categoryId,
                subCategoryId,
                price,
                currency,
                stock,
                thumbnails,
                conditionNotes
            } = req.body as any;

            const updateData: any = {};

            if (title) {
                updateData.title = title;
                updateData.slug = slugify(title);
            }

            if (subCategoryId) {
                const subExists = await fastify.prisma.subCategory.findUnique({
                    where: { id: subCategoryId }
                });
                if (!subExists) {
                    return reply.status(404).send({ message: "Invalid subCategoryId." });
                }
                updateData.subCategoryId = subCategoryId;
            }

            if (categoryId !== undefined) updateData.categoryId = categoryId || null;
            if (description !== undefined) updateData.description = description;
            if (price !== undefined) updateData.price = BigInt(price);
            if (currency !== undefined) updateData.currency = currency;
            if (stock !== undefined) updateData.stock = stock;
            if (thumbnails !== undefined) updateData.thumbnails = thumbnails;
            if (conditionNotes !== undefined) updateData.conditionNotes = conditionNotes;

            const updatedProduct = await fastify.prisma.products.update({
                where: { id: productId },
                data: updateData
            });

            return reply.send({
                message: "Product updated successfully.",
                ...updatedProduct
            });
        }
    });

    // ===========================
    // DELETE PRODUCT
    // ===========================
    fastify.delete('/products/:productId', {
        preHandler: authMidleware,
        handler: async (req, reply) => {
            const { productId } = req.params as any;
            const user = req.user;

            const product = await fastify.prisma.products.findUnique({
                where: { id: productId }
            });

            if (!product) {
                return reply.status(404).send({ message: "Product not found." });
            }

            if (!ensureOwnerOrAdmin(user, product.sellerUserId, reply)) return;

            await fastify.prisma.products.delete({
                where: { id: productId }
            });

            return reply.send({
                message: "Product deleted successfully."
            });
        }
    });
}
