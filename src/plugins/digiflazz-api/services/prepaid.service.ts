import { HttpClient } from "../utils/http.util";
import { SignatureUtil } from "../utils/signature.util";
import type { DigiflazzResponse, TopupData } from "../types";

export interface TopupOptions {
  /** Set true untuk mode testing/development */
  testing?: boolean;
  /** Batas harga maksimum transaksi */
  maxPrice?: number;
}

/**
 * Service untuk transaksi prabayar (pulsa, data, token listrik, dll).
 * Endpoint: POST /transaction
 */
export class PrepaidService {
  constructor(
    private readonly http: HttpClient,
    private readonly sig: SignatureUtil,
    private readonly username: string,
    private readonly globalTesting: boolean
  ) {}

  /**
   * Lakukan topup / transaksi prabayar.
   * @param skuCode    - Kode produk buyer (buyer_sku_code)
   * @param customerNo - Nomor tujuan (nomor HP, ID pelanggan, dll)
   * @param refId      - Ref ID unik dari sistem Anda (wajib unik per transaksi)
   * @param options    - Opsi tambahan (testing, maxPrice)
   */
  async topup(
    skuCode: string,
    customerNo: string,
    refId: string,
    options: TopupOptions = {}
  ): Promise<DigiflazzResponse<TopupData>> {
    const isTesting = options.testing ?? this.globalTesting;
    const body: Record<string, unknown> = {
      username: this.username,
      buyer_sku_code: skuCode,
      customer_no: customerNo,
      ref_id: refId,
      sign: this.sig.forTransaction(refId),
    };
    if (isTesting) body["testing"] = true;
    if (options.maxPrice !== undefined) body["max_price"] = options.maxPrice;

    return this.http.post<DigiflazzResponse<TopupData>>("/transaction", body);
  }

  /**
   * Cek status transaksi prabayar yang sudah dikirim.
   * Gunakan ref_id yang sama dengan saat topup.
   */
  async cekStatus(
    skuCode: string,
    customerNo: string,
    refId: string
  ): Promise<DigiflazzResponse<TopupData>> {
    return this.topup(skuCode, customerNo, refId);
  }
}
