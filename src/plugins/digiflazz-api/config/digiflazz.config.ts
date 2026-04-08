export interface DigiflazzConfig {
  username: string;
  apiKey: string;
  baseUrl: string;
  testing: boolean;
}

/**
 * Memuat konfigurasi dari environment variables.
 * Dapat di-override secara manual saat instansiasi DigiflazzClient.
 */
export function loadConfig(
  overrides?: Partial<DigiflazzConfig>,
): DigiflazzConfig {
  const username = overrides?.username ?? process.env.DIGIFLAZZ_USERNAME ?? "";
  const apiKey = overrides?.apiKey ?? process.env.DIGIFLAZZ_API_KEY ?? "";

  if (!username || !apiKey) {
    throw new Error(
      "[Digiflazz] DIGIFLAZZ_USERNAME dan DIGIFLAZZ_API_KEY wajib diisi. " +
        "Pastikan file .env sudah dikonfigurasi atau kirim manual via constructor.",
    );
  }

  return {
    username,
    apiKey,
    baseUrl: overrides?.baseUrl ?? "https://api.digiflazz.com/v1",
    testing: overrides?.testing ?? process.env.DIGIFLAZZ_TESTING === "true",
  };
}
