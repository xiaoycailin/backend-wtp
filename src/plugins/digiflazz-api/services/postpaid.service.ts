import { HttpClient } from "../utils/http.util";
import { SignatureUtil } from "../utils/signature.util";
import type { DigiflazzResponse, PascabayarData } from "../types";

export interface PascabayarOptions {
  testing?: boolean;
}

/**
 * Service untuk transaksi pascabayar (tagihan listrik, PDAM, BPJS, dll).
 * Endpoint: POST /transaction
 *
 * Alur wajib: cekTagihan() → bayarTagihan()
 * Jika bayarTagihan() mengembalikan status Pending → cekStatus()
 */
export class PostpaidService {
  constructor(
    private readonly http: HttpClient,
    private readonly sig: SignatureUtil,
    private readonly username: string,
    private readonly globalTesting: boolean
  ) {}

  private buildBody(
    skuCode: string,
    customerNo: string,
    refId: string,
    commands: "inq-pasca" | "pay-pasca" | "status-pasca",
    testing?: boolean
  ): Record<string, unknown> {
    const isTesting = testing ?? this.globalTesting;
    const body: Record<string, unknown> = {
      username: this.username,
      buyer_sku_code: skuCode,
      customer_no: customerNo,
      ref_id: refId,
      sign: this.sig.forTransaction(refId),
      commands,
    };
    if (isTesting) body["testing"] = true;
    return body;
  }

  /**
   * Inquiry / Cek tagihan pascabayar.
   * Wajib dilakukan sebelum pembayaran.
   */
  async cekTagihan(
    skuCode: string,
    customerNo: string,
    refId: string,
    options: PascabayarOptions = {}
  ): Promise<DigiflazzResponse<PascabayarData>> {
    return this.http.post<DigiflazzResponse<PascabayarData>>(
      "/transaction",
      this.buildBody(skuCode, customerNo, refId, "inq-pasca", options.testing)
    );
  }

  /**
   * Bayar tagihan pascabayar.
   * Harus didahului dengan cekTagihan() terlebih dahulu.
   */
  async bayarTagihan(
    skuCode: string,
    customerNo: string,
    refId: string,
    options: PascabayarOptions = {}
  ): Promise<DigiflazzResponse<PascabayarData>> {
    return this.http.post<DigiflazzResponse<PascabayarData>>(
      "/transaction",
      this.buildBody(skuCode, customerNo, refId, "pay-pasca", options.testing)
    );
  }

  /**
   * Cek status transaksi pascabayar.
   * Gunakan saat status pembayaran Pending.
   */
  async cekStatus(
    skuCode: string,
    customerNo: string,
    refId: string,
    options: PascabayarOptions = {}
  ): Promise<DigiflazzResponse<PascabayarData>> {
    return this.http.post<DigiflazzResponse<PascabayarData>>(
      "/transaction",
      this.buildBody(skuCode, customerNo, refId, "status-pasca", options.testing)
    );
  }
}
