import { getBootstrapSheets } from "@/lib/sheets/bootstrap-client";
import type { EncryptedSecretRecord, SecretKeyName, SecretMetadata } from "./types";
import { SECRET_KEY_NAMES } from "./types";

const SHEET_TITLE = "Integration Secrets";
const SHEET_RANGE = `${SHEET_TITLE}!A:K`;
const HEADERS = ["key_name", "ciphertext", "iv", "auth_tag", "algorithm", "key_version", "created_at", "updated_at", "last_four", "status", "notes"] as const;

function columnName(column: number): string {
  let value = column;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function isSecretKeyName(value: string): value is SecretKeyName {
  return (SECRET_KEY_NAMES as readonly string[]).includes(value);
}

let schemaSetup: Promise<void> | null = null;

async function provisionIntegrationSecretsSchema(): Promise<void> {
  const { sheets, spreadsheetId } = getBootstrapSheets();
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title,gridProperties(columnCount)))" });
  const integrationSheet = metadata.data.sheets?.find((sheet) => sheet.properties?.title === SHEET_TITLE);
  if (!integrationSheet) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: SHEET_TITLE } } }] } });
  } else {
    const sheetId = integrationSheet.properties?.sheetId;
    const columnCount = integrationSheet.properties?.gridProperties?.columnCount ?? 0;
    if (sheetId !== undefined && sheetId !== null && columnCount < HEADERS.length) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ appendDimension: { sheetId, dimension: "COLUMNS", length: HEADERS.length - columnCount } }] } });
    }
  }

  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SHEET_TITLE}!A1:K1` });
  const headers = response.data.values?.[0] ?? [];
  await Promise.all(HEADERS.map(async (header, index) => {
    if (String(headers[index] ?? "").trim()) return;
    await sheets.spreadsheets.values.update({ spreadsheetId, range: `${SHEET_TITLE}!${columnName(index + 1)}1`, valueInputOption: "USER_ENTERED", requestBody: { values: [[header]] } });
  }));
}

async function ensureIntegrationSecretsSchema(): Promise<void> {
  if (schemaSetup) return schemaSetup;
  const cached = provisionIntegrationSecretsSchema().catch((error) => {
    if (schemaSetup === cached) schemaSetup = null;
    throw error;
  });
  schemaSetup = cached;
  return cached;
}

async function listEncryptedSecretRecords(): Promise<EncryptedSecretRecord[]> {
  await ensureIntegrationSecretsSchema();
  const { sheets, spreadsheetId } = getBootstrapSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: SHEET_RANGE });
  return (response.data.values ?? []).slice(1).map((row, index) => {
    const keyName = String(row[0] ?? "");
    if (!isSecretKeyName(keyName)) return null;
    return {
      rowNumber: index + 2,
      keyName,
      ciphertext: String(row[1] ?? ""),
      iv: String(row[2] ?? ""),
      authTag: String(row[3] ?? ""),
      algorithm: String(row[4] ?? "") as "aes-256-gcm",
      keyVersion: String(row[5] ?? ""),
      createdAt: String(row[6] ?? ""),
      updatedAt: String(row[7] ?? ""),
      lastFour: String(row[8] ?? ""),
    };
  }).filter((record): record is EncryptedSecretRecord => Boolean(record));
}

export async function getSecretRecord(keyName: SecretKeyName): Promise<EncryptedSecretRecord | null> {
  return (await listEncryptedSecretRecords()).find((record) => record.keyName === keyName) ?? null;
}

export async function listSecretMetadata(): Promise<SecretMetadata[]> {
  return (await listEncryptedSecretRecords()).map(({ rowNumber, keyName, algorithm, keyVersion, createdAt, updatedAt, lastFour }) => ({ rowNumber, keyName, algorithm, keyVersion, createdAt, updatedAt, lastFour }));
}

export async function upsertSecretRecord(record: Omit<EncryptedSecretRecord, "rowNumber">): Promise<void> {
  const records = await listEncryptedSecretRecords();
  const existing = records.find((item) => item.keyName === record.keyName);
  const rowNumber = existing?.rowNumber ?? Math.max(2, ...records.map((item) => item.rowNumber + 1));
  const createdAt = existing?.createdAt || record.createdAt;
  const { sheets, spreadsheetId } = getBootstrapSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_TITLE}!A${rowNumber}:K${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[record.keyName, record.ciphertext, record.iv, record.authTag, record.algorithm, record.keyVersion, createdAt, record.updatedAt, record.lastFour, "ACTIVE", ""]] },
  });
}
