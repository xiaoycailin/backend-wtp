import md5 from "md5";

/**
 * Kelas helper untuk membuat signature MD5 sesuai dokumentasi Digiflazz.
 *
 * Rumus:
 *  - Cek Saldo  : md5(username + apiKey + "depo")
 *  - Daftar Harga: md5(username + apiKey + "pricelist")
 *  - Deposit    : md5(username + apiKey + "deposit")
 *  - Topup      : md5(username + apiKey + ref_id)
 *  - Inquiry PLN: md5(username + apiKey + "pln")
 */
export class SignatureUtil {
  constructor(
    private readonly username: string,
    private readonly apiKey: string,
  ) {}

  /** Signature untuk endpoint Cek Saldo */
  forCekSaldo(): string {
    return md5(`${this.username}${this.apiKey}depo`);
  }

  /** Signature untuk endpoint Daftar Harga */
  forDaftarHarga(): string {
    return md5(`${this.username}${this.apiKey}pricelist`);
  }

  /** Signature untuk endpoint Deposit */
  forDeposit(): string {
    return md5(`${this.username}${this.apiKey}deposit`);
  }

  /** Signature untuk endpoint Topup & Pascabayar (menggunakan ref_id) */
  forTransaction(refId: string): string {
    return md5(`${this.username}${this.apiKey}${refId}`);
  }

  /** Signature untuk endpoint Inquiry PLN */
  forInquiryPLN(): string {
    return md5(`${this.username}${this.apiKey}pln`);
  }
}
