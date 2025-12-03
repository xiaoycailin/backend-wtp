const convertCRC16 = (str) => {
    let crc = 0xFFFF;
    const strlen = str.length;

    for (let c = 0; c < strlen; c++) {
        crc ^= str.charCodeAt(c) << 8;

        for (let i = 0; i < 8; i++) {
            crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
        }
    }

    const hex = crc & 0xFFFF;
    return ("000" + hex.toString(16).toUpperCase()).slice(-4);
};

const generateQRIS = (amount) => {
    let qrisData = "00020101021126670016COM.NOBUBANK.WWW01189360050300000879140214055384375226780303UMI51440014ID.CO.QRIS.WWW0215ID20232646160040303UMI5204481253033605802ID5912QIOS PULSAKU6007CILACAP61055321162070703A0163044D91";
    const paymentAmount = amount;

    qrisData = qrisData.slice(0, -4);
    const step1 = qrisData.replace("010211", "010212");
    const step2 = step1.split("5802ID");

    let uang = "54" + ("0" + paymentAmount.length).slice(-2) + paymentAmount;
    uang += "5802ID";

    const result = step2[0] + uang + step2[1] + convertCRC16(step2[0] + uang + step2[1]);

    const qrCode = new QRCodeStyling({
        type: "svg",
        data: result,
        image: "",
        dotsOptions: {
            color: "#000",
            type: "rounded"
        },
        backgroundOptions: {
            color: "#fff",
        },
        imageOptions: {
            crossOrigin: "anonymous",
            margin: 20
        }
    });

    qrCode.append(document.getElementById("qris"));
};

generateQRIS()

