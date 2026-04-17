import fastifyFormbody from "@fastify/formbody";
import { FastInstance } from "../utils/fastify";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import DigiflazzClient from "../plugins/digiflazz-api";
import { createSystemLog } from "../utils/system-log";
import { refundToUserBalance, restorePromotionUsage } from "./payment.route";
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

const MidtransCallbackSchema = z.object({
  order_id: z.string().min(1),
  status_code: z.string().min(1),
  gross_amount: z.string().min(1),
  signature_key: z.string().min(1),
  transaction_status: z.string().min(1),
  fraud_status: z.string().optional(),
  payment_type: z.string().optional(),
  transaction_id: z.string().optional(),
  transaction_time: z.string().optional(),
  expiry_time: z.string().optional(),
  va_numbers: z.array(z.any()).optional(),
  permata_va_number: z.string().optional(),
  bill_key: z.string().optional(),
  biller_code: z.string().optional(),
  pdf_url: z.string().optional(),
});

type MidtransCallbackBody = z.infer<typeof MidtransCallbackSchema>;

function verifyMidtransSignature(
  body: MidtransCallbackBody,
  serverKey: string,
) {
  const rawSignature = `${body.order_id}${body.status_code}${body.gross_amount}${serverKey}`;
  const expectedSignature = createHash("sha512")
    .update(rawSignature)
    .digest("hex");
  return expectedSignature === body.signature_key;
}

async function creditWalletTopup(tx: any, topup: any) {
  if (topup.paymentStatus === "SUCCESS") return;

  await tx.balanceTopup.update({
    where: { id: topup.id },
    data: {
      paymentStatus: "SUCCESS",
      successAt: new Date(),
    },
  });

  await tx.userBalance.upsert({
    where: {
      userId_type: {
        userId: topup.userId,
        type: "WALLET",
      },
    },
    update: {
      amount: {
        increment: topup.amount,
      },
    },
    create: {
      userId: topup.userId,
      type: "WALLET",
      amount: topup.amount,
    },
  });

  await tx.moneyEntry.create({
    data: {
      userId: topup.userId,
      amount: topup.amount,
      ref: topup.topupCode,
      meta: {
        type: "BALANCE_TOPUP",
        topupId: topup.id,
        topupCode: topup.topupCode,
        paymentMethodId: topup.paymentMethodId,
      } as any,
    },
  });
}

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

  fastify.post("/callback/balance-topup/duitku", {
    handler: async (req, reply) => {
      const parseResult = DuitkuCallbackSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({ message: "Invalid payload" });
      }

      const body = parseResult.data;
      const merchantCode = process.env.MERCH_ID;
      const apiKey = process.env.API_KEY_DUITKU;
      if (
        !merchantCode ||
        !apiKey ||
        !verifyDuitkuSignature(body, merchantCode, apiKey)
      ) {
        return reply.status(401).send({ message: "Invalid signature" });
      }

      await fastify.prisma.$transaction(async (tx) => {
        const topup = await tx.balanceTopup.findFirst({
          where: { topupCode: body.merchantOrderId },
        });
        if (!topup) return;
        if (body.resultCode === "00") {
          await creditWalletTopup(tx, topup);
        } else if (topup.paymentStatus !== "FAILED") {
          await tx.balanceTopup.update({
            where: { id: topup.id },
            data: {
              paymentStatus: "FAILED",
              notes: `Duitku payment failed (${body.resultCode})`,
              paymentDetails: {
                ...(topup.paymentDetails as any),
                source: "DUITKU",
                callbackStatus: body.resultCode,
                callbackReference: body.reference,
                rawCallback: body,
              } as any,
            },
          });
        }
      });

      return reply.send({ message: "OK" });
    },
  });

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
        await createSystemLog(fastify, {
          type: "duitku_callback",
          source: "callback.payment.duitku",
          message: "Invalid Duitku callback payload",
          statusCode: 400,
          method: req.method,
          url: req.url,
          requestPayload: req.body,
          metadata: { errors: parseResult.error.issues },
          provider: "duitku",
        });
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
        await createSystemLog(fastify, {
          type: "duitku_callback",
          source: "callback.payment.duitku",
          message: "Duitku callback signature mismatch",
          statusCode: 401,
          method: req.method,
          url: req.url,
          trxId: body.merchantOrderId,
          provider: "duitku",
          requestPayload: body,
        });
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
            include: {
              product: {
                select: {
                  provider: true,
                },
              },
              paymentMethod: {
                select: {
                  methodCode: true,
                  source: true,
                },
              },
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

            // 6. Process berdasarkan provider product
            const provider = transaction.product?.provider ?? "digiflazz";

            if (provider === "digiflazz") {
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
                } catch (error: any) {
                  fastify.log.error(error, "something error");

                  await tx.transactions.update({
                    where: { id: transaction.id },
                    data: {
                      orderStatus: "FAILED",
                    },
                  });

                  await restorePromotionUsage(tx, transaction);

                  await tx.products.update({
                    where: { id: transaction.productId ?? "0" },
                    data: {
                      stock: {
                        increment: transaction.quantity,
                      },
                    },
                  });

                  if (transaction.flashSaleId) {
                    await tx.flashSale.update({
                      where: { id: transaction.flashSaleId },
                      data: {
                        stock: {
                          increment: transaction.quantity,
                        },
                      },
                    });
                  }

                  await refundToUserBalance({
                    tx,
                    userId: transaction.userId,
                    amount: Number(transaction.totalPrice ?? 0),
                    ref: transaction.trxId,
                    paymentMethodCode:
                      transaction.paymentMethod?.methodCode ?? null,
                    paymentSource: transaction.paymentMethod?.source ?? null,
                    meta: {
                      transactionId: transaction.id,
                      productId: transaction.productId,
                    },
                  });

                  if (error?.provider || error?.statusCode) {
                    await createSystemLog(fastify, {
                      type: "third_party_error",
                      source: "digiflazz.create_order",
                      message:
                        error?.data?.message ??
                        error?.message ??
                        "Gagal kirim order ke Digiflazz",
                      statusCode: error?.statusCode ?? 502,
                      method: req.method,
                      url: req.url,
                      trxId: transaction.trxId,
                      provider: error?.provider ?? "digiflazz",
                      requestPayload: error?.requestPayload ?? {
                        skuCode: transaction.skuCode,
                        customerNo: `${userData.primary_id}${userData.server_id}`,
                        refId: transaction.trxId,
                      },
                      responsePayload:
                        error?.responsePayload ?? error?.data ?? error ?? null,
                      errorStack: error?.stack ?? null,
                    });
                  }
                }
              } else {
                fastify.log.error("skuCode not found");
              }
            } else {
              fastify.log.info(
                { trxId: transaction.trxId, provider },
                "Manual provider detected, skipping Digiflazz order creation",
              );
            }
          } else {
            await tx.transactions.update({
              data: { paymentStatus: "FAILED", orderStatus: "FAILED" },
              where: { id: transaction.id },
            });

            await restorePromotionUsage(tx, transaction);

            // Restore stock on failure
            await tx.products.update({
              where: { id: transaction.productId ?? "0" },
              data: {
                stock: {
                  increment: transaction.quantity,
                },
              },
            });

            if (transaction.flashSaleId) {
              await tx.flashSale.update({
                where: { id: transaction.flashSaleId },
                data: {
                  stock: {
                    increment: transaction.quantity,
                  },
                },
              });
            }

            fastify.log.info({ trxId: body.merchantOrderId }, "Payment failed");
          }
        });
      } catch (err: any) {
        const statusCode = err.statusCode ?? 500;
        if (statusCode === 500) {
          fastify.log.error(err, "Unexpected error processing Duitku callback");
        }
        await createSystemLog(fastify, {
          type: "duitku_callback",
          source: "callback.payment.duitku",
          message:
            err?.message ?? "Unexpected error processing Duitku callback",
          statusCode,
          method: req.method,
          url: req.url,
          trxId: (req.body as any)?.merchantOrderId ?? null,
          provider: "duitku",
          requestPayload: req.body,
          errorStack: err?.stack ?? null,
        });
        return reply.status(statusCode).send({ message: err.message });
      }

      await createSystemLog(fastify, {
        type: "duitku_callback",
        source: "callback.payment.duitku",
        message: "Duitku callback processed",
        statusCode: 200,
        method: req.method,
        url: req.url,
        trxId: body.merchantOrderId,
        provider: "duitku",
        requestPayload: body,
        responsePayload: { message: "OK" },
      });

      return reply.send({ message: "OK" });
    },
  });

  fastify.post("/callback/payment/midtrans", {
    handler: async (req, reply) => {
      const parseResult = MidtransCallbackSchema.safeParse(req.body);
      if (!parseResult.success) {
        await createSystemLog(fastify, {
          type: "midtrans_callback",
          source: "callback.payment.midtrans",
          message: "Invalid Midtrans callback payload",
          statusCode: 400,
          method: req.method,
          url: req.url,
          provider: "midtrans",
          requestPayload: req.body,
          metadata: { errors: parseResult.error.issues },
        });
        return reply.status(400).send({ message: "Invalid payload" });
      }

      const body = parseResult.data;
      const serverKey = process.env.MIDTRANS_SERVER_KEY;
      if (!serverKey) {
        return reply
          .status(500)
          .send({ message: "Server configuration error" });
      }

      if (!verifyMidtransSignature(body, serverKey)) {
        await createSystemLog(fastify, {
          type: "midtrans_callback",
          source: "callback.payment.midtrans",
          message: "Midtrans callback signature mismatch",
          statusCode: 401,
          method: req.method,
          url: req.url,
          trxId: body.order_id,
          provider: "midtrans",
          requestPayload: body,
        });
        return reply.status(401).send({ message: "Invalid signature" });
      }

      try {
        await fastify.prisma.$transaction(async (tx) => {
          const successStatuses = ["capture", "settlement"];
          const failedStatuses = ["deny", "cancel", "expire", "failure"];
          const isSuccess =
            successStatuses.includes(body.transaction_status) &&
            (body.transaction_status !== "capture" ||
              body.fraud_status === "accept");

          const topup = await tx.balanceTopup.findFirst({
            where: { topupCode: body.order_id },
          });

          if (topup) {
            if (isSuccess) {
              await creditWalletTopup(tx, topup);
            } else if (
              failedStatuses.includes(body.transaction_status) &&
              topup.paymentStatus !== "FAILED"
            ) {
              await tx.balanceTopup.update({
                where: { id: topup.id },
                data: {
                  paymentStatus: "FAILED",
                  notes: `Midtrans ${body.transaction_status}`,
                  paymentDetails: {
                    ...(topup.paymentDetails as any),
                    source: "MIDTRANS",
                    transactionStatus: body.transaction_status,
                    rawCallback: body,
                  } as any,
                },
              });
            }
            return;
          }

          const transaction = await tx.transactions.findFirst({
            where: { trxId: body.order_id },
            include: {
              product: {
                select: {
                  provider: true,
                },
              },
              paymentMethod: {
                select: {
                  methodCode: true,
                  source: true,
                },
              },
            },
          });

          if (!transaction) {
            throw Object.assign(new Error("Transaction not found"), {
              statusCode: 404,
            });
          }

          if (isSuccess) {
            const firstSuccess = transaction.paymentStatus !== "SUCCESS";

            if (firstSuccess) {
              await tx.transactions.update({
                where: { id: transaction.id },
                data: {
                  paymentStatus: "SUCCESS",
                  orderStatus: "PENDING",
                  paymentDetails: {
                    ...(transaction.paymentDetails as any),
                    source: "MIDTRANS",
                    transactionStatus: body.transaction_status,
                    transactionId: body.transaction_id,
                    transactionTime: body.transaction_time,
                    expiryTime: body.expiry_time,
                    paymentType: body.payment_type,
                    vaNumber:
                      body.va_numbers?.[0]?.va_number ??
                      body.permata_va_number ??
                      null,
                    billKey: body.bill_key ?? null,
                    billerCode: body.biller_code ?? null,
                    pdfUrl: body.pdf_url ?? null,
                    rawCallback: body,
                  } as any,
                },
              });
            }

            if (!firstSuccess) {
              return;
            }

            const provider = transaction.product?.provider ?? "digiflazz";
            if (provider === "digiflazz") {
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
                } catch (error: any) {
                  await tx.transactions.update({
                    where: { id: transaction.id },
                    data: { orderStatus: "FAILED" },
                  });

                  await restorePromotionUsage(tx, transaction);

                  await tx.products.update({
                    where: { id: transaction.productId ?? "0" },
                    data: { stock: { increment: transaction.quantity } },
                  });

                  if (transaction.flashSaleId) {
                    await tx.flashSale.update({
                      where: { id: transaction.flashSaleId },
                      data: { stock: { increment: transaction.quantity } },
                    });
                  }

                  await refundToUserBalance({
                    tx,
                    userId: transaction.userId,
                    amount: Number(transaction.totalPrice ?? 0),
                    ref: transaction.trxId,
                    paymentMethodCode:
                      transaction.paymentMethod?.methodCode ?? null,
                    paymentSource: transaction.paymentMethod?.source ?? null,
                    meta: {
                      transactionId: transaction.id,
                      productId: transaction.productId,
                    },
                  });

                  if (error?.provider || error?.statusCode) {
                    await createSystemLog(fastify, {
                      type: "third_party_error",
                      source: "digiflazz.create_order",
                      message:
                        error?.data?.message ??
                        error?.message ??
                        "Gagal kirim order ke Digiflazz",
                      statusCode: error?.statusCode ?? 502,
                      method: req.method,
                      url: req.url,
                      trxId: transaction.trxId,
                      provider: error?.provider ?? "digiflazz",
                      requestPayload: error?.requestPayload ?? {
                        skuCode: transaction.skuCode,
                        customerNo: `${userData.primary_id}${userData.server_id}`,
                        refId: transaction.trxId,
                      },
                      responsePayload:
                        error?.responsePayload ?? error?.data ?? error ?? null,
                      errorStack: error?.stack ?? null,
                    });
                  }
                }
              }
            }
          } else if (failedStatuses.includes(body.transaction_status)) {
            const firstFailure = transaction.paymentStatus !== "FAILED";

            if (firstFailure) {
              await tx.transactions.update({
                where: { id: transaction.id },
                data: {
                  paymentStatus: "FAILED",
                  orderStatus: "FAILED",
                  paymentDetails: {
                    ...(transaction.paymentDetails as any),
                    source: "MIDTRANS",
                    transactionStatus: body.transaction_status,
                    rawCallback: body,
                  } as any,
                },
              });

              await restorePromotionUsage(tx, transaction);
              await tx.products.update({
                where: { id: transaction.productId ?? "0" },
                data: { stock: { increment: transaction.quantity } },
              });

              if (transaction.flashSaleId) {
                await tx.flashSale.update({
                  where: { id: transaction.flashSaleId },
                  data: { stock: { increment: transaction.quantity } },
                });
              }
            }
          } else {
            await tx.transactions.update({
              where: { id: transaction.id },
              data: {
                paymentDetails: {
                  ...(transaction.paymentDetails as any),
                  source: "MIDTRANS",
                  transactionStatus: body.transaction_status,
                  rawCallback: body,
                } as any,
              },
            });
          }
        });
      } catch (err: any) {
        const statusCode = err.statusCode ?? 500;
        await createSystemLog(fastify, {
          type: "midtrans_callback",
          source: "callback.payment.midtrans",
          message:
            err?.message ?? "Unexpected error processing Midtrans callback",
          statusCode,
          method: req.method,
          url: req.url,
          trxId: (req.body as any)?.order_id ?? null,
          provider: "midtrans",
          requestPayload: req.body,
          errorStack: err?.stack ?? null,
        });
        return reply.status(statusCode).send({ message: err.message });
      }

      await createSystemLog(fastify, {
        type: "midtrans_callback",
        source: "callback.payment.midtrans",
        message: "Midtrans callback processed",
        statusCode: 200,
        method: req.method,
        url: req.url,
        trxId: body.order_id,
        provider: "midtrans",
        requestPayload: body,
        responsePayload: { message: "OK" },
      });

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
        await createSystemLog(fastify, {
          type: "digiflazz_callback",
          source: "callback.agregator.digiflazz",
          message: "Digiflazz callback signature mismatch",
          statusCode: 401,
          method: req.method,
          url: req.url,
          provider: "digiflazz",
          requestPayload: req.body,
          metadata: { signatureHeader },
        });
        return reply.status(401).send({ message: "Invalid signature" });
      }

      // 2. Validasi payload
      const parseResult = DigiflazzCallbackSchema.safeParse(req.body);
      if (!parseResult.success) {
        fastify.log.warn(
          { errors: parseResult.error.issues },
          "Invalid Digiflazz callback payload",
        );
        await createSystemLog(fastify, {
          type: "digiflazz_callback",
          source: "callback.agregator.digiflazz",
          message: "Invalid Digiflazz callback payload",
          statusCode: 400,
          method: req.method,
          url: req.url,
          provider: "digiflazz",
          requestPayload: req.body,
          metadata: { errors: parseResult.error.issues },
        });
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
            include: {
              paymentMethod: {
                select: {
                  methodCode: true,
                  source: true,
                },
              },
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
            typeof transaction.providerData === "object" &&
            transaction.providerData !== null
              ? (transaction.providerData as Record<string, any>)
              : {};
          const retryHistory = Array.isArray(currentProviderData.retryHistory)
            ? [...currentProviderData.retryHistory]
            : [];
          const retryIndex = retryHistory.findIndex(
            (item: any) => item?.refId === trxData.ref_id,
          );
          const baseRetryEntry =
            retryIndex >= 0 ? retryHistory[retryIndex] : null;

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
                                buyer_last_saldo:
                                  trxData.buyer_last_saldo ?? null,
                              }
                            : item,
                        )
                      : retryHistory,
                },
              },
            });

            if (transaction.flashSaleId) {
              await tx.flashSale.update({
                where: { id: transaction.flashSaleId },
                data: {
                  sellCount: {
                    increment: transaction.quantity,
                  },
                },
              });
            }

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

            await restorePromotionUsage(tx, transaction);

            // Restore stock karena transaksi gagal di provider
            await tx.products.update({
              where: { id: transaction.productId ?? "0" },
              data: {
                stock: { increment: transaction.quantity },
              },
            });

            if (transaction.flashSaleId) {
              await tx.flashSale.update({
                where: { id: transaction.flashSaleId },
                data: {
                  stock: { increment: transaction.quantity },
                },
              });
            }

            fastify.log.info(transaction, "Proses Pengembalian dana");
            await refundToUserBalance({
              tx,
              userId: transaction.userId,
              amount: Number(transaction.totalPrice ?? 0),
              ref: transaction.trxId,
              paymentMethodCode: transaction.paymentMethod?.methodCode ?? null,
              paymentSource: transaction.paymentMethod?.source ?? null,
              meta: {
                transactionId: transaction.id,
                productId: transaction.productId,
                digiflazzRefId: trxData.ref_id,
                digiflazzRc: trxData.rc,
              },
            });

            fastify.log.info(
              { ref_id: trxData.ref_id, rc: trxData.rc },
              "Digiflazz transaction failed, stock restored and balance refunded if eligible",
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
        await createSystemLog(fastify, {
          type: "digiflazz_callback",
          source: "callback.agregator.digiflazz",
          message: err?.message ?? "Error processing Digiflazz callback",
          statusCode: 500,
          method: req.method,
          url: req.url,
          trxId: (req.body as any)?.data?.ref_id ?? null,
          provider: "digiflazz",
          requestPayload: req.body,
          errorStack: err?.stack ?? null,
        });
        // Tetap return 200 agar Digiflazz tidak infinite-retry
        // Error di-log untuk ditangani manual
      }

      await createSystemLog(fastify, {
        type: "digiflazz_callback",
        source: "callback.agregator.digiflazz",
        message: "Digiflazz callback processed",
        statusCode: 200,
        method: req.method,
        url: req.url,
        trxId: trxData.ref_id,
        provider: "digiflazz",
        requestPayload: req.body,
        responsePayload: { message: "OK" },
      });

      // Selalu balas 200 OK ke Digiflazz
      return reply.send({ message: "OK" });
    },
  });
}
