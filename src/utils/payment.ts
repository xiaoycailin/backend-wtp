import crypto from "crypto";

export class ThirdPartyHttpError extends Error {
  statusCode: number;
  provider: string;
  responsePayload?: unknown;
  requestPayload?: unknown;

  constructor(input: {
    message: string;
    statusCode: number;
    provider: string;
    responsePayload?: unknown;
    requestPayload?: unknown;
  }) {
    super(input.message);
    this.name = "ThirdPartyHttpError";
    this.statusCode = input.statusCode;
    this.provider = input.provider;
    this.responsePayload = input.responsePayload;
    this.requestPayload = input.requestPayload;
  }
}

export type PaymentDetails = {
  email?: string;
  phoneNumber?: string;
  paymentMethod: string;
  merchantOrderId: string;

  quantity?: number;
  itemName: string;
  amount: number;

  callbackUrl: string;
  returnUrl: string;

  expiryPeriod?: number;
};

export type MidtransPaymentDetails = {
  orderId: string;
  amount: number;
  itemName: string;
  quantity?: number;
  email?: string;
  phoneNumber?: string;
  paymentMethod?: string;
  finishUrl?: string;
};

const sandboxUrl = "https://sandbox.duitku.com";
const produrl = "https://passport.duitku.com";

export class DuitKu {
  getBaseUrl(env?: "sandbox" | "production") {
    let url = sandboxUrl;

    if (env == "sandbox") {
      url = sandboxUrl;
    } else if (env == "production") {
      url = produrl;
    } else {
      url = sandboxUrl;
    }

    return url;
  }

  async createPayment(details: PaymentDetails, env?: "sandbox" | "production") {
    const merchantCode = process.env.MERCH_ID || "";
    const apiKey = process.env.API_KEY_DUITKU || "";

    const paymentAmount = details.amount;
    const expiryPeriod = details.expiryPeriod || 10;
    const email = details.email;
    const phoneNumber = details.phoneNumber;
    const paymentMethod = details.paymentMethod;
    const merchantOrderId = details.merchantOrderId;

    const signature = crypto
      .createHash("md5")
      .update(merchantCode + merchantOrderId + paymentAmount + apiKey)
      .digest("hex");

    const customerDetail = {
      phoneNumber,
      email,
    };

    const itemDetails = [
      {
        name: details.itemName,
        price: paymentAmount,
        quantity: details.quantity,
      },
    ];

    const params = {
      merchantCode,
      paymentAmount,
      paymentMethod,
      merchantOrderId,
      email,
      itemDetails,
      customerDetail,
      callbackUrl: details.callbackUrl,
      returnUrl: details.returnUrl,
      signature,
      expiryPeriod,
    };

    const response = await fetch(
      this.getBaseUrl(env) + "/webapi/api/merchant/v2/inquiry",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      },
    );

    const raw = await response.text();
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }

    if (response.ok) {
      return parsed;
    }

    throw new ThirdPartyHttpError({
      message: "Duitku create payment request failed",
      statusCode: response.status,
      provider: "duitku",
      responsePayload: parsed,
      requestPayload: params,
    });
  }
  async paymentMethod(env?: "sandbox" | "production") {
    const merchantcode = process.env.MERCH_ID || "";
    const apiKey = process.env.API_KEY_DUITKU || "";

    const paymentAmount = 10000;
    const dateTime = new Date()
      .toISOString()
      .replace("T", " ")
      .substring(0, 19);
    const signature = crypto
      .createHash("sha256")
      .update(merchantcode + paymentAmount + dateTime + apiKey)
      .digest("hex");

    const params = {
      merchantcode,
      amount: paymentAmount,
      datetime: dateTime,
      signature,
    };

    const response = await fetch(
      this.getBaseUrl(env) +
        "/webapi/api/merchant/paymentmethod/getpaymentmethod",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      },
    );

    const raw = await response.text();
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }

    if (response.ok) {
      return parsed;
    }

    throw new ThirdPartyHttpError({
      message: "Duitku payment method request failed",
      statusCode: response.status,
      provider: "duitku",
      responsePayload: parsed,
      requestPayload: params,
    });
  }
}

export class Midtrans {
  getApiBaseUrl(isProduction?: boolean) {
    return isProduction
      ? "https://api.midtrans.com"
      : "https://api.sandbox.midtrans.com";
  }

  async createPayment(
    details: MidtransPaymentDetails,
    isProduction = false,
  ) {
    const serverKey = process.env.MIDTRANS_SERVER_KEY || "";

    const payload: Record<string, any> = {
      transaction_details: {
        order_id: details.orderId,
        gross_amount: details.amount,
      },
      item_details: [
        {
          id: details.orderId,
          price: details.amount,
          quantity: details.quantity || 1,
          name: details.itemName,
        },
      ],
      customer_details: {
        email: details.email,
        phone: details.phoneNumber,
      },
    };

    if (details.paymentMethod) {
      const method = details.paymentMethod.toLowerCase();

      if (["bca_va", "bni_va", "bri_va", "permata_va"].includes(method)) {
        payload.payment_type = "bank_transfer";
        payload.bank_transfer = {
          bank: method.replace("_va", ""),
        };
      } else if (method.startsWith("bank_transfer:")) {
        payload.payment_type = "bank_transfer";
        payload.bank_transfer = {
          bank: method.split(":")[1],
        };
      } else if (method.startsWith("cstore:")) {
        payload.payment_type = "cstore";
        payload.cstore = {
          store: method.split(":")[1],
        };
      } else {
        payload.payment_type = method;
      }
    }

    if (details.finishUrl) {
      payload.callbacks = {
        finish: details.finishUrl,
      };
    }

    const auth = Buffer.from(`${serverKey}:`).toString("base64");
    const response = await fetch(`${this.getApiBaseUrl(isProduction)}/v2/charge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let parsed: any = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }

    if (response.ok || parsed?.status_code === "201") {
      const vaNumber = Array.isArray(parsed?.va_numbers)
        ? parsed.va_numbers?.[0]?.va_number
        : parsed?.permata_va_number;
      const paymentUrl =
        parsed?.actions?.find((action: any) => action?.name === "generate-qr-code")?.url ||
        parsed?.actions?.find((action: any) => action?.name === "deeplink-redirect")?.url ||
        parsed?.redirect_url ||
        parsed?.pdf_url ||
        null;

      return {
        source: "MIDTRANS",
        transactionId: parsed?.transaction_id,
        orderId: parsed?.order_id,
        transactionStatus: parsed?.transaction_status,
        transactionTime: parsed?.transaction_time,
        expiryTime: parsed?.expiry_time,
        paymentType: parsed?.payment_type,
        paymentUrl,
        vaNumber,
        billKey: parsed?.bill_key,
        billerCode: parsed?.biller_code,
        qrString: parsed?.qr_string,
        actions: parsed?.actions ?? [],
        raw: parsed,
      };
    }

    throw new ThirdPartyHttpError({
      message: parsed?.status_message ?? "Midtrans create payment request failed",
      statusCode: response.status,
      provider: "midtrans",
      responsePayload: parsed,
      requestPayload: payload,
    });
  }
}
