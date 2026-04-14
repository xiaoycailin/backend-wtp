import { z } from "zod";

export const paymentMethodCreateSchema = z.object({
  methodCode: z.string().trim().min(1),
  paymentName: z.string().trim().min(1),
  source: z.enum(["DUITKU"]),
  thumbnail: z.string().url(),
  feeType: z.enum(["flat", "percent"]),
  feeValue: z.number().min(0),
  paymentVisibility: z.enum(["active", "nonactive"]),
  group: z.enum(["qris", "va", "retail", "ewallet"]).nullable().optional(),
});

export const paymentMethodUpdateSchema = paymentMethodCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field must be provided." },
);

const userDataSchema = z
  .object({
    primary_id: z.string().trim().min(1),
    server_id: z.string().trim().optional(),
    username: z.string().trim().optional(),
  })
  .partial()
  .passthrough();

export const paymentReviewSchema = z.object({
  itemId: z.string().trim().min(1),
  paymentMethod: z.number().int().positive(),
  qty: z.number().int().positive().max(10),
  userData: userDataSchema.default({}),
  flashId: z.number().int().positive().optional(),
  promoCode: z.string().trim().optional(),
});

export const paymentPurchaseSchema = z.object({
  itemId: z.string().trim().min(1),
  paymentMethod: z.number().int().positive(),
  qty: z.number().int().positive().max(10),
  email: z.string().trim().email(),
  phoneNumber: z.string().trim().min(8).max(20).optional(),
  userData: userDataSchema.default({}),
  flashId: z.number().int().positive().optional(),
  promoCode: z.string().trim().optional(),
});

export const paymentPricesSchema = z.object({
  itemId: z.string().trim().min(1),
  qty: z.number().int().positive().max(10),
  flashId: z.number().int().positive().optional(),
  promoCode: z.string().trim().optional(),
});
