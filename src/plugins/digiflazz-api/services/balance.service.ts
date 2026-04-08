import { HttpClient } from "../utils/http.util";
import { SignatureUtil } from "../utils/signature.util";
import type {
  DigiflazzResponse,
  SaldoData,
} from "../types";

/**
 * Service untuk memeriksa saldo deposit Digiflazz.
 * Endpoint: POST /cek-saldo
 */
export class BalanceService {
  constructor(
    private readonly http: HttpClient,
    private readonly sig: SignatureUtil,
    private readonly username: string
  ) {}

  /**
   * Cek saldo deposit akun Digiflazz Anda.
   * @returns Jumlah saldo deposit saat ini
   */
  async cekSaldo(): Promise<DigiflazzResponse<SaldoData>> {
    return this.http.post<DigiflazzResponse<SaldoData>>("/cek-saldo", {
      cmd: "deposit",
      username: this.username,
      sign: this.sig.forCekSaldo(),
    });
  }
}
