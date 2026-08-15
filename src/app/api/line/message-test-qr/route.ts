import QRCode from "qrcode";
import sharp from "sharp";

import { runtimeConfig } from "@/lib/runtime-config";

const QR_SIZE = 640;
const LABEL_HEIGHT = 96;

function testLabel(): Buffer {
  return Buffer.from(`<svg width="${QR_SIZE}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="320" y="58" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#b91c1c">TEST — NOT PAYABLE</text>
  </svg>`);
}

export async function GET(): Promise<Response> {
  try {
    const { publicBaseUrl } = await runtimeConfig();
    const testUrl = `${publicBaseUrl.replace(/\/+$/, "")}/line/message-test`;
    const qr = await QRCode.toBuffer(testUrl, {
      width: QR_SIZE,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    const png = await sharp({
      create: {
        width: QR_SIZE,
        height: QR_SIZE + LABEL_HEIGHT,
        channels: 3,
        background: "#ffffff",
      },
    }).composite([
      { input: qr, top: 0, left: 0 },
      { input: testLabel(), top: QR_SIZE, left: 0 },
    ]).png().toBuffer();

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Internal Server Error", { status: 500 });
  }
}
