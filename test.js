import crypto from "crypto"

const merchantCode = "DXXXX";
const apiKey = "DXXXXCX80TZJ85Q70QCI";

const datetime = new Date().toISOString().replace("T", " ").substring(0, 19);
const paymentAmount = 10000;

const signature = crypto
    .createHash("sha256")
    .update(merchantCode + paymentAmount + datetime + apiKey)
    .digest("hex");

const params = {
    merchantcode: merchantCode,
    amount: paymentAmount,
    datetime: datetime,
    signature: signature,
};

const url =
    "https://sandbox.duitku.com/webapi/api/merchant/paymentmethod/getpaymentmethod";

const response = await fetch(url, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
});

if (response.ok) {
    const results = await response.json();
    console.log(results);
} else {
    const error = await response.json();
    console.error(`Server Error ${response.status} ${error.Message}`);
}
