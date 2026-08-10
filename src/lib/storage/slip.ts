import { Readable } from "node:stream";
import { google } from "googleapis";
import { serverConfig } from "@/lib/config";

export function shouldRetainSlip(status: string, retentionDays: number): boolean {
  return retentionDays > 0 && (status === "REVIEW" || status === "FLAGGED");
}

export async function storeExceptionSlip(input: { bytes: Uint8Array; mimeType: string; paymentId: string; imageHash: string }): Promise<string> {
  const config = serverConfig();
  const credentials = JSON.parse(config.serviceAccountJson) as Record<string, string>;
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/drive.file"] });
  const drive = google.drive({ version: "v3", auth });
  const created = await drive.files.create({
    requestBody: { name: `slip-${input.paymentId}-${input.imageHash.slice(0, 12)}`, parents: [config.slipStorageFolderId], mimeType: input.mimeType },
    media: { mimeType: input.mimeType, body: Readable.from(Buffer.from(input.bytes)) },
    fields: "id"
  });
  if (!created.data.id) throw new Error("Private slip storage did not return a file ID");
  return `https://drive.google.com/open?id=${created.data.id}`;
}
