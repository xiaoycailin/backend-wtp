// ─── Cek Saldo ────────────────────────────────────────────────────────────────
export interface CekSaldoRequest {
  cmd: "deposit";
  username: string;
  sign: string;
}

// ─── Daftar Harga ─────────────────────────────────────────────────────────────
export type ProductType = "prepaid" | "pasca";

export interface DaftarHargaRequest {
  cmd: ProductType;
  username: string;
  sign: string;
  code?: string;
  category?: string;
  brand?: string;
  type?: string;
}

// ─── Deposit ──────────────────────────────────────────────────────────────────
export type BankName = "BRI" | "MANDIRI" | "BNI" | "BCA";

export interface DepositRequest {
  username: string;
  amount: number;
  bank: BankName;
  owner_name: string;
  sign: string;
}

// ─── Topup Prabayar ───────────────────────────────────────────────────────────
export interface TopupRequest {
  username: string;
  buyer_sku_code: string;
  customer_no: string;
  ref_id: string;
  sign: string;
  testing?: boolean;
  max_price?: number;
}

// ─── Pascabayar ───────────────────────────────────────────────────────────────
export type PascabayarCommand = "inq-pasca" | "pay-pasca" | "status-pasca";

export interface PascabayarRequest {
  username: string;
  buyer_sku_code: string;
  customer_no: string;
  ref_id: string;
  sign: string;
  commands: PascabayarCommand;
  testing?: boolean;
}

// ─── Inquiry PLN ──────────────────────────────────────────────────────────────
export interface InquiryPLNRequest {
  username: string;
  customer_no: string;
  sign: string;
}
