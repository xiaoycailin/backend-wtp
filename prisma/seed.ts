// prisma/seed.ts
// Default data untuk SiteConfig

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  await prisma.siteConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      // Identitas
      siteName: "WTPANJAY",
      tagline: "Top-Up Game Terpercaya di Indonesia",
      description:
        "Platform top-up game online terlengkap. Isi diamond, kredit, dan voucher game favorit kamu dengan cepat, aman, dan harga terbaik.",
      siteUrl: "https://wtpanjay.com",
      timezone: "Asia/Jakarta",
      locale: "id-ID",

      // Meta SEO default
      metaTitle: "WTPANJAY — Top-Up Game Terpercaya di Indonesia",
      metaDescription:
        "Top-up game online terlengkap & termurah. Mobile Legends, Free Fire, PUBG, Genshin Impact, dan 50+ game lainnya. Proses instan, aman, & terpercaya.",
      metaKeywords:
        "topup game, top up ml, top up free fire, beli diamond, topup murah, wtpanjay",
      metaRobots: "index, follow",

      // Open Graph
      ogTitle: "WTPANJAY — Top-Up Game Terpercaya",
      ogDescription:
        "Top-up game online terlengkap & termurah. 50+ game tersedia, proses instan.",
      ogType: "website",
      ogLocale: "id_ID",

      // Twitter
      twitterCard: "summary_large_image",

      // Schema.org
      schemaOrgType: "Organization",

      // Analytics (isi sesuai akun)
      googleAnalyticsId: "",
      googleTagManagerId: "",

      // Kontak
      contactEmail: "hello@wtpanjay.com",
      supportEmail: "support@wtpanjay.com",
      supportWhatsapp: "+6281234567890",

      // Maintenance (off by default)
      maintenanceMode: false,
      maintenanceTitle: "Sedang Dalam Pemeliharaan",
      maintenanceMessage:
        "Kami sedang melakukan peningkatan sistem. Mohon tunggu sebentar.",

      // Branding
      primaryColor: "#f5c518",
      secondaryColor: "#0e0e0e",
      accentColor: "#ffffff",
    },
  });
}
main();
