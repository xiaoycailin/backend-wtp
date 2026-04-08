/**
 * Contoh penggunaan DigiflazzClient
 * Jalankan dengan: npx ts-node src/example.ts
 *
 * Pastikan file .env sudah dikonfigurasi sebelum menjalankan.
 */
import { DigiflazzClient } from "./index";

async function main() {
  // Inisialisasi client (membaca dari .env secara otomatis)
  const digiflazz = new DigiflazzClient();

  console.log("=".repeat(60));
  console.log(" Digiflazz API Client — Contoh Penggunaan");
  console.log("=".repeat(60));
  console.log("Config:", digiflazz.getConfig());
  console.log();

  try {
    // ── 1. Cek Saldo ────────────────────────────────────────────
    console.log("1. Mengecek saldo...");
    const saldo = await digiflazz.balance.cekSaldo();
    console.log("   Saldo:", saldo.data.deposit);
    console.log();

    // ── 2. Daftar Harga Prabayar ─────────────────────────────────
    console.log("2. Mengambil daftar harga prabayar (filter: Telkomsel)...");
    const harga = await digiflazz.product.daftarHarga("prepaid", {
      brand: "Telkomsel",
    });
    console.log(`   Ditemukan ${harga.data.length} produk`);
    if (harga.data.length > 0) {
      const p = harga.data[0];
      console.log(
        `   Contoh: [${p.buyer_sku_code}] ${p.product_name} — Rp${p.price}`,
      );
    }
    console.log();

    // ── 3. Inquiry PLN ───────────────────────────────────────────
    console.log("3. Inquiry PLN (nomor meter contoh)...");
    const pln = await digiflazz.pln.inquiryPLN("530000000001");
    console.log("   Nama pelanggan :", pln.data.name);
    console.log("   Daya/Segment   :", pln.data.segment_power);
    console.log();

    // ── 4. Topup Prabayar (mode testing) ────────────────────────
    console.log("4. Topup prabayar (testing mode)...");
    const topup = await digiflazz.prepaid.topup(
      "xld10", // buyer_sku_code — ganti dengan kode produk Anda
      "081234567890", // nomor tujuan
      `REF-${Date.now()}`, // ref_id unik
      { testing: true },
    );
    console.log("   Status  :", topup.data.status);
    console.log("   RC      :", topup.data.rc);
    console.log("   Message :", topup.data.message);
    console.log();

    // ── 5. Inquiry Pascabayar ────────────────────────────────────
    console.log("5. Inquiry pascabayar (testing mode)...");
    const refId = `PASCA-${Date.now()}`;
    const inquiry = await digiflazz.postpaid.cekTagihan(
      "PLNPOSTPAID", // buyer_sku_code pascabayar
      "530000000001", // nomor pelanggan
      refId,
      { testing: true },
    );
    console.log("   Status  :", inquiry.data.status);
    console.log("   Message :", inquiry.data.message);

    if (inquiry.data.status === "Sukses") {
      console.log("\n   Membayar tagihan...");
      const bayar = await digiflazz.postpaid.bayarTagihan(
        "PLNPOSTPAID",
        "530000000001",
        refId, // gunakan ref_id yang SAMA dengan inquiry
        { testing: true },
      );
      console.log("   Status Bayar:", bayar.data.status);
      console.log("   SN          :", bayar.data.sn ?? "(pending)");
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
