import { HttpClient } from "../utils/http.util";
import { SignatureUtil } from "../utils/signature.util";
import type {
  DigiflazzResponse,
  DepositData,
  BankName,
} from "../types";

/**
 * Service untuk membuat tiket deposit ke Digiflazz.
 * Endpoint: POST /deposit
 */
export class DepositService {
  constructor(
    private readonly http: HttpClient,
    private readonly sig: SignatureUtil,
    private readonly username: string
  ) {}

  /**
   * Buat tiket deposit.
   * @param amount    - Jumlah nominal deposit (dalam Rupiah)
   * @param bank      - Bank tujuan transfer: BRI | MANDIRI | BNI | BCA
   * @param ownerName - Nama pemilik rekening pengirim
   */
  async deposit(
    amount: number,
    bank: BankName,
    ownerName: string
  ): Promise<DigiflazzResponse<DepositData>> {
    return this.http.post<DigiflazzResponse<DepositData>>("/deposit", {
      username: this.username,
      amount,
      bank,
      owner_name: ownerName,
      sign: this.sig.forDeposit(),
    });
  }
}
