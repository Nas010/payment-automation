import { getBootstrapSheets } from "@/lib/sheets/bootstrap-client";
import type { GoogleOwnerIdentity, InstallationRecord, SetupStatus } from "./types";

const SHEET_TITLE = "Installation";
const OWNER_CLAIM_RANGE = "installation_owner_claim";
const HEADERS = ["owner_google_sub", "owner_email", "setup_status", "created_at", "updated_at"] as const;
const STATUS_ORDER: Record<SetupStatus, number> = { CLAIMED: 0, WORKSPACE_CONNECTED: 1, COMPLETE: 2 };

let schemaSetup: Promise<number> | null = null;

function parseRecord(row: unknown[] | undefined): InstallationRecord | null {
  if (!row) return null;
  const ownerGoogleSub = String(row[0] ?? "").trim();
  const ownerEmail = String(row[1] ?? "").trim().toLowerCase();
  const setupStatus = String(row[2] ?? "") as SetupStatus;
  const createdAt = String(row[3] ?? "");
  const updatedAt = String(row[4] ?? "");
  if (!ownerGoogleSub || !ownerEmail || !(setupStatus in STATUS_ORDER) || Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt))) return null;
  return { ownerGoogleSub, ownerEmail, setupStatus, createdAt, updatedAt };
}

async function provisionInstallationSchema(): Promise<number> {
  const { sheets, spreadsheetId } = getBootstrapSheets();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,gridProperties(columnCount))),namedRanges(namedRangeId,name,range)",
  });
  let installationSheet = metadata.data.sheets?.find((sheet) => sheet.properties?.title === SHEET_TITLE);
  if (!installationSheet) {
    try {
      const created = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: SHEET_TITLE, hidden: true, gridProperties: { rowCount: 10, columnCount: HEADERS.length } } } }] },
      });
      const sheetId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
      if (sheetId === undefined || sheetId === null) throw new Error("Installation sheet could not be created.");
      installationSheet = { properties: { sheetId, title: SHEET_TITLE } };
    } catch {
      const refreshed = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
      installationSheet = refreshed.data.sheets?.find((sheet) => sheet.properties?.title === SHEET_TITLE);
      if (!installationSheet) throw new Error("Installation sheet could not be created.");
    }
  }

  const sheetId = installationSheet.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error("Installation sheet is invalid.");
  const headerResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SHEET_TITLE}!A1:E1` });
  const headers = headerResponse.data.values?.[0] ?? [];
  if (HEADERS.some((header, index) => String(headers[index] ?? "") !== header)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TITLE}!A1:E1`,
      valueInputOption: "RAW",
      requestBody: { values: [[...HEADERS]] },
    });
  }
  return sheetId;
}

async function ensureInstallationSchema(): Promise<number> {
  if (schemaSetup) return schemaSetup;
  const cached = provisionInstallationSchema().catch((error) => {
    if (schemaSetup === cached) schemaSetup = null;
    throw error;
  });
  schemaSetup = cached;
  return cached;
}

export async function getInstallation(): Promise<InstallationRecord | null> {
  await ensureInstallationSchema();
  const { sheets, spreadsheetId } = getBootstrapSheets();
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${SHEET_TITLE}!A1:E2` });
  return parseRecord(response.data.values?.[1]);
}

function cell(value: string) {
  return { userEnteredValue: { stringValue: value } };
}

export async function claimInstallationOwner(identity: GoogleOwnerIdentity, now = new Date()): Promise<InstallationRecord> {
  const googleSub = identity.googleSub.trim();
  const email = identity.email.trim().toLowerCase();
  if (!googleSub || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("Verified Google identity is required.");

  const sheetId = await ensureInstallationSchema();
  const existing = await getInstallation();
  if (existing) {
    if (existing.ownerGoogleSub !== googleSub) throw new Error("This installation already has an owner.");
    return existing;
  }

  const timestamp = now.toISOString();
  const record: InstallationRecord = { ownerGoogleSub: googleSub, ownerEmail: email, setupStatus: "CLAIMED", createdAt: timestamp, updatedAt: timestamp };
  const range = { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: HEADERS.length };
  const { sheets, spreadsheetId } = getBootstrapSheets();
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { addNamedRange: { namedRange: { name: OWNER_CLAIM_RANGE, range } } },
          { updateCells: { range, rows: [{ values: [cell(googleSub), cell(email), cell("CLAIMED"), cell(timestamp), cell(timestamp)] }], fields: "userEnteredValue" } },
        ],
      },
    });
    return record;
  } catch {
    const claimed = await getInstallation();
    if (claimed?.ownerGoogleSub === googleSub) return claimed;
    if (claimed) throw new Error("This installation already has an owner.");
    throw new Error("Installation ownership could not be claimed.");
  }
}

export async function setInstallationStatus(ownerGoogleSub: string, status: SetupStatus, now = new Date()): Promise<InstallationRecord> {
  const existing = await getInstallation();
  if (!existing || existing.ownerGoogleSub !== ownerGoogleSub) throw new Error("Installation owner could not be verified.");
  if (STATUS_ORDER[status] < STATUS_ORDER[existing.setupStatus]) return existing;
  const updatedAt = now.toISOString();
  const { sheets, spreadsheetId } = getBootstrapSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_TITLE}!C2:E2`,
    valueInputOption: "RAW",
    requestBody: { values: [[status, existing.createdAt, updatedAt]] },
  });
  return { ...existing, setupStatus: status, updatedAt };
}
