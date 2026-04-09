import fastifyFormbody from "@fastify/formbody";
import { FastInstance } from "../utils/fastify";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import DigiflazzClient from "plugins/digiflazz-api";

// ─── Duitku ──────────────────────────────────────────────────────────────────

function verifyDuitkuSignature(
  body: DuitkuCallbackBody,
  merchantCode: string,
  apiKey: string,
): boolean {
  const rawSignature = `${merchantCode}${body.amount}${body.merchantOrderId}${apiKey}`;
  const expectedSignature = createHash("md5")
    .update(rawSignature)
    .digest("hex");
  return expectedSignature === body.signature;
}

const DuitkuCallbackSchema = z.object({
  merchantCode: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  merchantOrderId: z.string().min(1),
  productDetail: z.string().optional(),
  additionalParam: z.string().optional(),
  paymentCode: z.string().optional(),
  resultCode: z.enum(["00", "01"]),
  merchantUserId: z.string().optional(),
  reference: z.string().min(1),
  signature: z.string().min(1),
  publisherOrderId: z.string().optional(),
  spUserHash: z.string().optional(),
  settlementDate: z.string().optional(),
  issuerCode: z.string().optional(),
  vaNumber: z.string().optional(),
});

type DuitkuCallbackBody = z.infer<typeof DuitkuCallbackSchema>;

// ─── Digiflazz ───────────────────────────────────────────────────────────────

/**
 * Verifikasi X-Hub-Signature dari Digiflazz.
 * Menggunakan HMAC-SHA1 dengan webhook secret sebagai key
 * dan raw body sebagai data, lalu dibandingkan secara timing-safe.
 *
 * @see https://developer.digiflazz.com/api/buyer/webhook/
 */
function verifyDigiflazzSignature(
  signatureHeader: string | undefined,
  rawBody: string,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha1=")) return false;

  const receivedSig = signatureHeader.slice(5); // buang prefix "sha1="
  const expectedSig = createHmac("sha1", secret).update(rawBody).digest("hex");

  // Gunakan timingSafeEqual untuk mencegah timing attack
  if (receivedSig.length !== expectedSig.length) return false;
  return timingSafeEqual(
    Buffer.from(receivedSig, "hex"),
    Buffer.from(expectedSig, "hex"),
  );
}

/**
 * Schema Zod untuk callback prabayar Digiflazz.
 * Field opsional ditambahkan agar bisa menangani callback
 * baik dari prepaid maupun postpaid (User-Agent berbeda).
 */
const DigiflazzCallbackSchema = z.object({
  data: z.object({
    ref_id: z.string().min(1),
    customer_no: z.string().min(1),
    buyer_sku_code: z.string().min(1),
    message: z.string(),
    status: z.enum(["Sukses", "Pending", "Gagal"]),
    rc: z.string(),
    sn: z.string().optional(),
    buyer_last_saldo: z.number().optional(),
    price: z.number().optional(),
    selling_price: z.number().optional(),
    tele: z.string().optional(),
    wa: z.string().optional(),

    // Field tambahan untuk pascabayar
    customer_name: z.string().optional(),
    admin: z.number().optional(),
    periode: z.string().optional(),
    desc: z.unknown().optional(),
  }),
});

type DigiflazzCallbackBody = z.infer<typeof DigiflazzCallbackSchema>;

// ─── Plugin ──────────────────────────────────────────────────────────────────

export default async function (fastify: FastInstance) {
  fastify.register(fastifyFormbody);

  /**
   * PENTING: Fastify secara default mem-parse JSON body dan tidak
   * menyimpan raw body. Kita butuh raw body untuk verifikasi HMAC.
   * Tambahkan content-type parser khusus yang menyimpan rawBody.
   */
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, body, done) => {
      try {
        // Simpan raw body di request untuk verifikasi signature
        (req as any).rawBody = body as string;
        const json = JSON.parse(body as string);
        done(null, json);
      } catch (err: any) {
        done(err, undefined);
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  //  Duitku Callback (kode existing, tidak diubah)
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post("/callback/payment/duitku", {
    handler: async (req, reply) => {
      // 1. Validate body structure
      const parseResult = DuitkuCallbackSchema.safeParse(req.body);
      if (!parseResult.success) {
        fastify.log.warn(
          { errors: parseResult.error.issues },
          "Invalid Duitku callback payload",
        );
        return reply.status(400).send({ message: "Invalid payload" });
      }

      const body = parseResult.data;

      // 2. Verify Duitku signature
      const merchantCode = process.env.MERCH_ID;
      const apiKey = process.env.API_KEY_DUITKU;

      if (!merchantCode || !apiKey) {
        fastify.log.error("MERCH_ID or API_KEY_DUITKU env variable is missing");
        return reply
          .status(500)
          .send({ message: "Server configuration error" });
      }

      if (!verifyDuitkuSignature(body, merchantCode, apiKey)) {
        fastify.log.warn(
          { merchantOrderId: body.merchantOrderId },
          "Duitku callback signature mismatch",
        );
        return reply.status(401).send({ message: "Invalid signature" });
      }

      // 3. Process inside a DB transaction to prevent race conditions
      try {
        await fastify.prisma.$transaction(async (tx) => {
          const transaction = await tx.transactions.findFirst({
            where: {
              trxId: body.merchantOrderId,
              paymentStatus: "PENDING",
              orderStatus: "WAIT_PAYMENT",
            },
          });

          // 4. Idempotency check
          if (!transaction) {
            const alreadyProcessed = await tx.transactions.findFirst({
              where: {
                trxId: body.merchantOrderId,
                paymentStatus: { in: ["SUCCESS", "FAILED"] },
              },
            });

            if (alreadyProcessed) {
              fastify.log.info(
                { trxId: body.merchantOrderId },
                "Duplicate callback received, already processed",
              );
              return;
            }

            throw Object.assign(new Error("Transaction not found"), {
              statusCode: 404,
            });
          }

          const paymentDetails = transaction.paymentDetails as Record<
            string,
            string
          > | null;

          if (!paymentDetails) {
            throw Object.assign(new Error("Payment details missing"), {
              statusCode: 400,
            });
          }

          // 5. Verify payment details
          const vaMatch = paymentDetails.vaNumber === body.vaNumber;
          const refMatch = paymentDetails.reference === body.reference;

          if (!vaMatch || !refMatch) {
            fastify.log.warn(
              { trxId: body.merchantOrderId },
              "VA number or reference mismatch",
            );
            throw Object.assign(new Error("Payment details mismatch"), {
              statusCode: 400,
            });
          }

          if (body.resultCode === "00") {
            await tx.transactions.update({
              data: { paymentStatus: "SUCCESS", orderStatus: "PENDING" },
              where: { id: transaction.id },
            });

            fastify.log.info(
              { trxId: body.merchantOrderId },
              "Payment success",
            );

            // 6. Proces to digiflazz
            const df = new DigiflazzClient();
            const userData = transaction.userAccountData as any;

            if (transaction.skuCode) {
              try {
                const requestTrx = await df.prepaid.topup(
                  transaction.skuCode,
                  `${userData.primary_id}${userData.server_id}`,
                  transaction.trxId,
                );
                fastify.log.info(requestTrx, "TRX DIGIFLAZZ");
              } catch (error) {
                fastify.log.error(error, "something error");
              }
            } else {
              fastify.log.error("skuCode not found");
            }
          } else {
            await tx.transactions.update({
              data: { paymentStatus: "FAILED", orderStatus: "FAILED" },
              where: { id: transaction.id },
            });

            // Restore stock on failure
            await tx.products.update({
              where: { id: transaction.productId },
              data: {
                stock: {
                  increment: transaction.quantity,
                },
              },
            });

            fastify.log.info({ trxId: body.merchantOrderId }, "Payment failed");
          }
        });
      } catch (err: any) {
        const statusCode = err.statusCode ?? 500;
        if (statusCode === 500) {
          fastify.log.error(err, "Unexpected error processing Duitku callback");
        }
        return reply.status(statusCode).send({ message: err.message });
      }

      return reply.send({ message: "OK" });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  Digiflazz Aggregator Callback
  // ═══════════════════════════════════════════════════════════════════════════

  fastify.post("/callback/agregator/digiflazz", {
    handler: async (req, reply) => {
      const rawBody = (req as any).rawBody as string | undefined;

      // 1. Verifikasi X-Hub-Signature (HMAC-SHA1)
      const webhookSecret = process.env.DIGIFLAZZ_WEBHOOK_SECRET;

      if (!webhookSecret) {
        fastify.log.error("DIGIFLAZZ_WEBHOOK_SECRET env variable is missing");
        return reply
          .status(500)
          .send({ message: "Server configuration error" });
      }

      if (!rawBody) {
        fastify.log.warn("Missing raw body for signature verification");
        return reply.status(400).send({ message: "Invalid request body" });
      }

      const signatureHeader = req.headers["x-hub-signature"] as
        | string
        | undefined;

      if (!verifyDigiflazzSignature(signatureHeader, rawBody, webhookSecret)) {
        fastify.log.warn(
          { signature: signatureHeader },
          "Digiflazz callback signature mismatch",
        );
        return reply.status(401).send({ message: "Invalid signature" });
      }

      // 2. Validasi payload
      const parseResult = DigiflazzCallbackSchema.safeParse(req.body);
      if (!parseResult.success) {
        fastify.log.warn(
          { errors: parseResult.error.issues },
          "Invalid Digiflazz callback payload",
        );
        return reply.status(400).send({ message: "Invalid payload" });
      }

      const { data: trxData } = parseResult.data;
      const event = req.headers["x-digiflazz-event"] as string | undefined;
      const userAgent = req.headers["user-agent"] ?? "";
      const isPostpaid = userAgent.toLowerCase().includes("pasca");

      fastify.log.info(
        {
          ref_id: trxData.ref_id,
          event,
          status: trxData.status,
          rc: trxData.rc,
          is_postpaid: isPostpaid,
        },
        "Digiflazz callback received",
      );

      // 3. Proses di dalam DB transaction
      try {
        await fastify.prisma.$transaction(async (tx) => {
          // Cari transaksi berdasarkan ref_id (trxId di DB kita)
          const transaction = await tx.transactions.findFirst({
            where: {
              OR: [
                { trxId: trxData.ref_id },
                {
                  providerData: {
                    path: "$.retryRefId",
                    equals: trxData.ref_id,
                  },
                },
              ],
            },
          });

          if (!transaction) {
            fastify.log.warn(
              { ref_id: trxData.ref_id },
              "Transaction not found for Digiflazz callback",
            );
            return; // Balas 200 OK agar Digiflazz tidak retry terus
          }

          // Idempotency: skip jika orderStatus sudah final
          if (
            transaction.orderStatus === "SUCCESS" ||
            transaction.orderStatus === "FAILED"
          ) {
            fastify.log.info(
              { ref_id: trxData.ref_id, orderStatus: transaction.orderStatus },
              "Duplicate Digiflazz callback, already processed",
            );
            return;
          }

          // 4. Update status berdasarkan response Digiflazz
          const currentProviderData =
            typeof transaction.providerData === "object" && transaction.providerData !== null
              ? (transaction.providerData as Record<string, any>)
              : {};
          const retryHistory = Array.isArray(currentProviderData.retryHistory)
            ? [...currentProviderData.retryHistory]
            : [];
          const retryIndex = retryHistory.findIndex((item: any) => item?.refId === trxData.ref_id);
          const baseRetryEntry = retryIndex >= 0 ? retryHistory[retryIndex] : null;

          if (trxData.status === "Sukses") {
            await tx.transactions.update({
              where: { id: transaction.id },
              data: {
                orderStatus: "SUCCESS",
                serialNumber: trxData.sn,

                providerData: {
                  ...currentProviderData,
                  lastRefId: trxData.ref_id,
                  sn: trxData.sn ?? null,
                  rc: trxData.rc,
                  message: trxData.message,
                  price: trxData.price ?? null,
                  buyer_last_saldo: trxData.buyer_last_saldo ?? null,
                  retryHistory:
                    retryIndex >= 0
                      ? retryHistory.map((item: any, index: number) =>
                          index === retryIndex
                            ? {
                                ...baseRetryEntry,
                                callbackStatus: trxData.status,
                                callbackMessage: trxData.message,
                                callbackAt: new Date().toISOString(),
                                rc: trxData.rc,
                                sn: trxData.sn ?? null,
                                price: trxData.price ?? null,
                                buyer_last_saldo: trxData.buyer_last_saldo ?? null,
                              }
                            : item,
                        )
                      : retryHistory,
                },
              },
            });

            fastify.log.info(
              { ref_id: trxData.ref_id, sn: trxData.sn },
              "Digiflazz transaction success",
            );
          } else if (trxData.status === "Gagal") {
            await tx.transactions.update({
              where: { id: transaction.id },
              data: {
                orderStatus: "FAILED",
                providerData: {
                  ...currentProviderData,
                  lastRefId: trxData.ref_id,
                  rc: trxData.rc,
                  message: trxData.message,
                  retryHistory:
                    retryIndex >= 0
                      ? retryHistory.map((item: any, index: number) =>
                          index === retryIndex
                            ? {
                                ...baseRetryEntry,
                                callbackStatus: trxData.status,
                                callbackMessage: trxData.message,
                                callbackAt: new Date().toISOString(),
                                rc: trxData.rc,
                              }
                            : item,
                        )
                      : retryHistory,
                },
              },
            });

            // Restore stock karena transaksi gagal di provider
            await tx.products.update({
              where: { id: transaction.productId },
              data: {
                stock: { increment: transaction.quantity },
              },
            });

            fastify.log.info(
              { ref_id: trxData.ref_id, rc: trxData.rc },
              "Digiflazz transaction failed, stock restored",
            );
          } else {
            // status === "Pending" → hanya log, tunggu callback berikutnya
            fastify.log.info(
              { ref_id: trxData.ref_id },
              "Digiflazz transaction still pending",
            );
          }
        });
      } catch (err: any) {
        fastify.log.error(err, "Error processing Digiflazz callback");
        // Tetap return 200 agar Digiflazz tidak infinite-retry
        // Error di-log untuk ditangani manual
      }

      // Selalu balas 200 OK ke Digiflazz
      return reply.send({ message: "OK" });
    },
  });
}
