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
