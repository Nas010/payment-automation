import { createDriveSlipFile } from "./drive-client";
import { getSlipStorageFolder } from "./drive-folder";

export function shouldRetainSlip(status: string, retentionDays: number): boolean {
  return retentionDays > 0 && (status === "REVIEW" || status === "FLAGGED");
}

export async function storeExceptionSlip(input: { bytes: Uint8Array; mimeType: string; paymentId: string; imageHash: string }, {
  getSlipStorageFolder: resolveFolder = getSlipStorageFolder,
  createDriveSlipFile: createFile = createDriveSlipFile,
}: {
  getSlipStorageFolder?: typeof getSlipStorageFolder;
  createDriveSlipFile?: typeof createDriveSlipFile;
} = {}): Promise<string> {
  const folder = await resolveFolder();
  const fileId = await createFile({ ...input, folderId: folder.folderId });
  return `https://drive.google.com/open?id=${fileId}`;
}
