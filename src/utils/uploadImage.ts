import { PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, pubUrl } from "./s3";

export async function uploadImage(
  buffer: Buffer,
  fileName: string,
  mime: string,
) {
  const key = `uploads/${Date.now()}-${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: "wtp-storage",
      Key: key,
      Body: buffer,
      ContentType: mime,
    }),
  );
  return pubUrl + key;
}
