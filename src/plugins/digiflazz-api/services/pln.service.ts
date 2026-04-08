import { HttpClient } from "../utils/http.util";
import { SignatureUtil } from "../utils/signature.util";
import type { DigiflazzResponse, InquiryPLNData } from "../types";

/**
 * Service untuk inquiry nomor pelanggan PLN.
 * Endpoint: POST /transaction
 *
 * Gunakan sebelum melakukan topup token listrik
 * untuk memvalidasi nomor meter/ID pelanggan PLN.
 */
export class PLNService {
  constructor(
    private readonly http: HttpClient,
    private readonly sig: SignatureUtil,
    private readonly username: string
  ) {}

  /**
   * Inquiry data pelanggan PLN berdasarkan nomor meter atau ID pelanggan.
   * @param customerNo - Nomor meter atau ID pelanggan PLN
   */
  async inquiryPLN(customerNo: string): Promise<DigiflazzResponse<InquiryPLNData>> {
    return this.http.post<DigiflazzResponse<InquiryPLNData>>("/transaction", {
      username: this.username,
      customer_no: customerNo,
      sign: this.sig.forInquiryPLN(),
    });
  }
}
