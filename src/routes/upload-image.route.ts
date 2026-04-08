import { FastInstance } from "../utils/fastify";
import path, { join } from "path";
import crypto from "crypto";
import fs from "fs";
import { pipeline } from "stream/promises";
import mime from "mime-types";
import { uploadImage } from "../utils/uploadImage";
import { authMiddleware } from "../plugins/authMiddleware";

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

      return reply.status(201).send({
        message: "Uploaded successfully",
        filename,
        url: `/static/uploads/${filename}`,
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

      const url = await uploadImage(
        buffer,
        sanitizeFilename(file.filename),
        file.mimetype,
      );

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
