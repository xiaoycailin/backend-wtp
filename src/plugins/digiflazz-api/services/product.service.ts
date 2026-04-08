import { HttpClient } from "../utils/http.util";
import { SignatureUtil } from "../utils/signature.util";
import type {
  DigiflazzResponse,
  ProductItem,
  ProductType,
} from "../types";

export interface DaftarHargaOptions {
  /** Filter berdasarkan kode produk */
  code?: string;
  /** Filter berdasarkan kategori (misal: "Pulsa", "Data") */
  category?: string;
  /** Filter berdasarkan brand (misal: "Telkomsel", "XL") */
  brand?: string;
  /** Filter berdasarkan tipe produk */
  type?: string;
}

/**
 * Service untuk mengambil daftar harga produk Digiflazz.
 * Endpoint: POST /price-list
 */
export class ProductService {
  constructor(
    private readonly http: HttpClient,
    private readonly sig: SignatureUtil,
    private readonly username: string
  ) {}

  /**
   * Ambil daftar harga produk prabayar atau pascabayar.
   * @param productType - "prepaid" untuk prabayar, "pasca" untuk pascabayar
   * @param options     - Filter opsional (code, category, brand, type)
   */
  async daftarHarga(
    productType: ProductType = "prepaid",
    options: DaftarHargaOptions = {}
  ): Promise<DigiflazzResponse<ProductItem[]>> {
    return this.http.post<DigiflazzResponse<ProductItem[]>>("/price-list", {
      cmd: productType,
      username: this.username,
      sign: this.sig.forDaftarHarga(),
      ...options,
    });
  }
}
