export interface HttpError {
  statusCode: number;
  message: string;
  data?: unknown;
  provider?: string;
  url?: string;
  requestPayload?: unknown;
}

/**
 * HTTP Client menggunakan Node.js native fetch (zero dependency).
 * Menggantikan axios untuk menghindari risiko supply-chain attack.
 *
 * Semua request ke Digiflazz menggunakan metode POST + JSON.
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(baseUrl: string, timeout = 30_000) {
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * Kirim POST request ke endpoint yang ditentukan.
   * @param endpoint - Path endpoint (misal: "/cek-saldo")
   * @param body     - Body JSON yang akan dikirim
   */
  async post<TResponse>(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<TResponse> {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const data: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const httpError: HttpError = {
          statusCode: response.status,
          message: this.extractErrorMessage(data),
          data,
          provider: "digiflazz",
          url,
          requestPayload: body,
        };
        throw httpError;
      }

      return data as TResponse;
    } catch (error: unknown) {
      // Re-throw HttpError tanpa wrapping
      if (this.isHttpError(error)) throw error;

      // Handle timeout (AbortError)
      if (error instanceof DOMException && error.name === "AbortError") {
        const httpError: HttpError = {
          statusCode: 408,
          message: `Request timeout setelah ${this.timeout}ms`,
          provider: "digiflazz",
          url,
          requestPayload: body,
        };
        throw httpError;
      }

      // Handle network / fetch error lainnya
      const httpError: HttpError = {
        statusCode: 500,
        message:
          error instanceof Error
            ? error.message
            : "Terjadi kesalahan pada request",
        provider: "digiflazz",
        url,
        requestPayload: body,
      };
      throw httpError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private extractErrorMessage(data: unknown): string {
    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>;
      if (typeof obj["message"] === "string") return obj["message"];
      if (obj["data"] && typeof obj["data"] === "object") {
        const inner = obj["data"] as Record<string, unknown>;
        if (typeof inner["message"] === "string") return inner["message"];
      }
    }
    return "Terjadi kesalahan pada request";
  }

  private isHttpError(error: unknown): error is HttpError {
    return (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      "message" in error
    );
  }
}
