import { randomUUID } from "node:crypto";
import { saveLineTermsImageVersion } from "@/lib/sheets/settings";
import { createDriveTermsImageFile } from "@/lib/storage/drive-client";
import { getSlipStorageFolder } from "@/lib/storage/drive-folder";
import {
  LineTermsImageError,
  validateLineTermsImageBytes,
  type LineTermsImageVersion,
} from "./terms-image";

type UploadDependencies = {
  getFolder: typeof getSlipStorageFolder;
  createFile: typeof createDriveTermsImageFile;
  saveVersion: typeof saveLineTermsImageVersion;
  createId: () => string;
  now: () => string;
};

const runtimeDependencies: UploadDependencies = {
  getFolder: getSlipStorageFolder,
  createFile: createDriveTermsImageFile,
  saveVersion: saveLineTermsImageVersion,
  createId: () => randomUUID().replaceAll("-", ""),
  now: () => new Date().toISOString(),
};

export async function uploadLineTermsImage(
  input: { bytes: Uint8Array; originalName: string },
  dependencies: UploadDependencies = runtimeDependencies,
): Promise<LineTermsImageVersion> {
  let mimeType: LineTermsImageVersion["mimeType"];
  try {
    mimeType = validateLineTermsImageBytes(input.bytes);
  } catch (error) {
    if (error instanceof LineTermsImageError && error.code === "INVALID_FILE") {
      throw new LineTermsImageError("INVALID_FILE", "Choose a JPEG or PNG image.");
    }
    throw error;
  }
  const originalName = input.originalName.trim().split(/[\\/]/).at(-1)?.slice(0, 120) || (mimeType === "image/png" ? "terms.png" : "terms.jpg");
  const folder = await dependencies.getFolder();
  const versionId = `terms_${dependencies.createId()}`;
  const publicToken = dependencies.createId();
  const driveFileId = await dependencies.createFile({ bytes: input.bytes, mimeType, versionId, folderId: folder.folderId });
  const version: LineTermsImageVersion = {
    versionId,
    publicToken,
    driveFileId,
    mimeType,
    byteLength: input.bytes.byteLength,
    originalName,
    uploadedAt: dependencies.now(),
  };
  await dependencies.saveVersion(version);
  return version;
}
