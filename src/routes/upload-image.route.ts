import { FastInstance } from "../utils/fastify";
import path, { join } from "path";
import crypto from "crypto";
import fs from "fs";
import { pipeline } from "stream/promises";
import mime from "mime-types";
import { uploadImage } from "../utils/uploadImage";
import { authMiddleware } from "../plugins/authMiddleware";
import { serializeData } from "../utils/json";

const UPLOAD_DIR = join(process.cwd(), "static/uploads");
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function sanitizeFilename(filename: string) {
  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");

  return `${crypto.randomUUID()}-${safeName}`;
}

function assertAllowedMime(mimetype: string) {
  return ALLOWED_MIME.includes(mimetype);
}

export default async function (fastify: FastInstance) {
  fastify.get("/images", {
    preHandler: authMiddleware,
    handler: async (_req, reply) => {
      const items = await (fastify.prisma as any).mediaAsset.findMany({
        orderBy: { createdAt: "desc" },
      });

      return reply.send(
        serializeData({
          items,
        }),
      );
    },
  });

  fastify.post("/images/upload", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const file = await req.file();
      if (!file) {
        return reply.status(400).send({ message: "No file uploaded" });
      }

      if (!assertAllowedMime(file.mimetype)) {
        return reply.status(400).send({ message: "Invalid file type" });
      }

      const filename = sanitizeFilename(file.filename);
      const filePath = join(UPLOAD_DIR, filename);

      await pipeline(file.file, fs.createWriteStream(filePath));

      const stats = fs.statSync(filePath);
      if (stats.size > MAX_FILE_BYTES) {
        fs.unlinkSync(filePath);
        return reply.status(400).send({ message: "File too large" });
      }

      const url = `/static/uploads/${filename}`;
      await (fastify.prisma as any).mediaAsset.create({
        data: {
          url,
          filename,
          mimeType: file.mimetype,
          size: stats.size,
          provider: "local",
        },
      });

      return reply.status(201).send({
        message: "Uploaded successfully",
        filename,
        url,
        size: stats.size,
      });
    },
  });

  fastify.post("/aws/s3/upload", {
    preHandler: authMiddleware,
    handler: async (req, reply) => {
      const file = await req.file();
      if (!file) {
        return reply.status(400).send({ message: "No file uploaded" });
      }

      if (!assertAllowedMime(file.mimetype)) {
        return reply.status(400).send({ message: "Invalid file type" });
      }

      const buffer = await file.toBuffer();
      if (buffer.length > MAX_FILE_BYTES) {
        return reply.status(400).send({ message: "File too large" });
      }

      const sanitizedFilename = sanitizeFilename(file.filename);
      const url = await uploadImage(
        buffer,
        sanitizedFilename,
        file.mimetype,
      );

      await (fastify.prisma as any).mediaAsset.create({
        data: {
          url,
          filename: sanitizedFilename,
          mimeType: file.mimetype,
          size: buffer.length,
          provider: "r2",
        },
      });

      return reply.status(201).send({
        message: "Uploaded successfully",
        url,
        size: buffer.length,
      });
    },
  });

  fastify.get("/static/uploads/:filename", {
    handler: async (req, reply) => {
      const { filename } = req.params as { filename: string };

      if (
        filename.includes("..") ||
        filename.includes("/") ||
        filename.includes("\\")
      ) {
        return reply.status(400).send({ message: "Invalid filename" });
      }

      const filePath = join(UPLOAD_DIR, filename);
      if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ message: "File not found" });
      }

      const contentType = mime.lookup(filename) || "application/octet-stream";
      return reply
        .header("Content-Type", contentType)
        .send(fs.createReadStream(filePath));
    },
  });
}
