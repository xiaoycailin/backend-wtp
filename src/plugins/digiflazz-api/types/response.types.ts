/**
 * Wrapper generik dari semua response Digiflazz.
 * Digiflazz membungkus semua response di dalam key "data".
 */
export interface DigiflazzResponse<T> {
  data: T;
}

// ─── Cek Saldo ────────────────────────────────────────────────────────────────
export interface SaldoData {
  deposit: number;
}

// ─── Daftar Harga ─────────────────────────────────────────────────────────────
export interface ProductItem {
  product_name: string;
  category: string;
  brand: string;
  type: string;
  seller_name: string;
  price: number;
  buyer_sku_code: string;
  buyer_product_status: boolean;
  seller_product_status: boolean;
  unlimited_stock: boolean;
  stock: number;
  multi: boolean;
  start_cut_off: string;
  end_cut_off: string;
  desc: string;
}

// ─── Deposit ──────────────────────────────────────────────────────────────────
export interface DepositData {
  rc: string;
  amount: number;
  notes: string;
}

// ─── Topup Prabayar ───────────────────────────────────────────────────────────
export interface TopupData {
  ref_id: string;
  customer_no: string;
  buyer_sku_code: string;
  message: string;
  status: "Sukses" | "Pending" | "Gagal";
  rc: string;
  sn?: string;
  buyer_last_saldo?: number;
  price?: number;
  tele?: string;
  wa?: string;
}

// ─── Pascabayar ───────────────────────────────────────────────────────────────
export interface PascabayarData {
  ref_id: string;
  customer_no: string;
  buyer_sku_code: string;
  message: string;
  status: "Sukses" | "Pending" | "Gagal";
  rc: string;
  sn?: string;
  price?: number;
  selling_price?: number;
  desc?: Record<string, unknown>;
  buyer_last_saldo?: number;
  tele?: string;
  wa?: string;
}

// ─── Inquiry PLN ──────────────────────────────────────────────────────────────
export interface InquiryPLNData {
  customer_no: string;
  meter_no: string;
  subscriber_id: string;
  name: string;
  segment_power: string;
  message?: string;
}

// ─── Error Response ───────────────────────────────────────────────────────────
export interface DigiflazzErrorData {
  rc: string;
  message: string;
}
