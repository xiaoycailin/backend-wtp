import { loadConfig, DigiflazzConfig } from "./config/digiflazz.config";
import { HttpClient } from "./utils/http.util";
import { SignatureUtil } from "./utils/signature.util";
import { BalanceService } from "./services/balance.service";
import { ProductService } from "./services/product.service";
import { DepositService } from "./services/deposit.service";
import { PrepaidService } from "./services/prepaid.service";
import { PostpaidService } from "./services/postpaid.service";
import { PLNService } from "./services/pln.service";

export * from "./types";
export * from "./config/digiflazz.config";
export * from "./utils/http.util";
export * from "./services/product.service";
export * from "./services/prepaid.service";
export * from "./services/postpaid.service";

/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║           DigiflazzClient — Buyer API Client             ║
 * ╠══════════════════════════════════════════════════════════╣
 * ║  Satu titik akses ke seluruh layanan Digiflazz Buyer.    ║
 * ║                                                          ║
 * ║  Penggunaan:                                             ║
 * ║    const client = new DigiflazzClient();                 ║
 * ║    // Ambil credentials dari .env otomatis               ║
 * ║                                                          ║
 * ║    const client = new DigiflazzClient({                  ║
 * ║      username: "user123",                                ║
 * ║      apiKey: "abc123secret",                             ║
 * ║      testing: true,                                      ║
 * ║    });                                                   ║
 * ╚══════════════════════════════════════════════════════════╝
 */
export class DigiflazzClient {
  private readonly config: DigiflazzConfig;

  /** Cek saldo deposit akun Anda */
  public readonly balance: BalanceService;

  /** Daftar harga produk prabayar & pascabayar */
  public readonly product: ProductService;

  /** Tiket deposit saldo */
  public readonly deposit: DepositService;

  /** Transaksi prabayar (pulsa, data, token, voucher, dll) */
  public readonly prepaid: PrepaidService;

  /** Transaksi pascabayar (tagihan listrik, PDAM, BPJS, dll) */
  public readonly postpaid: PostpaidService;

  /** Inquiry data pelanggan PLN */
  public readonly pln: PLNService;

  constructor(overrides?: Partial<DigiflazzConfig>) {
    this.config = loadConfig(overrides);

    const http = new HttpClient(this.config.baseUrl);
    const sig = new SignatureUtil(this.config.username, this.config.apiKey);
    const { username, testing } = this.config;

    this.balance = new BalanceService(http, sig, username);
    this.product = new ProductService(http, sig, username);
    this.deposit = new DepositService(http, sig, username);
    this.prepaid = new PrepaidService(http, sig, username, testing);
    this.postpaid = new PostpaidService(http, sig, username, testing);
    this.pln = new PLNService(http, sig, username);
  }

  /** Kembalikan konfigurasi aktif (apiKey disembunyikan) */
  getConfig(): Omit<DigiflazzConfig, "apiKey"> & { apiKey: string } {
    return {
      ...this.config,
      apiKey:
        this.config.apiKey.replace(/./g, "*").slice(0, -4) +
        this.config.apiKey.slice(-4),
    };
  }
}

export default DigiflazzClient;
