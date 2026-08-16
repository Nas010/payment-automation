import { createHash } from "node:crypto";
import { isLineReservationConflict, lineReservationName } from "@/lib/line/connection-reservation";
import {
  LINE_MESSAGE_TEST_PROFILE_SETTING_KEY,
  parseLineMessageTestProfile,
  type LineMessageTestProfile,
} from "@/lib/line/message-test-profile";
import type { LineConnectionClaimResult } from "./clients";
import { getGoogleSheets } from "./client";
import { listOperationalSettings, upsertOperationalSetting } from "./settings";

type ProfileUpdateInput = {
  expectedProfile: LineMessageTestProfile;
  profile: LineMessageTestProfile;
};

type ClaimInput = ProfileUpdateInput & {
  tokenHash: string;
  lineUserId: string;
};

type SettingsMetadata = {
  sheetId: number;
  namedRanges: Array<{ name?: string | null; namedRangeId?: string | null }>;
};

function stateReservationName(profile: LineMessageTestProfile): string {
  const stateHash = createHash("sha256").update(JSON.stringify(parseLineMessageTestProfile(profile))).digest("hex");
  return `line_message_test_state_${stateHash}`;
}

function stringCell(value: string) {
  return { userEnteredValue: { stringValue: value } };
}

async function settingsMetadata(): Promise<SettingsMetadata> {
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title)),namedRanges(namedRangeId,name)",
  });
  const sheetId = response.data.sheets?.find((sheet) => sheet.properties?.title === "Settings")?.properties?.sheetId;
  if (sheetId === undefined || sheetId === null) throw new Error("Settings sheet is required");
  return { sheetId, namedRanges: response.data.namedRanges ?? [] };
}

async function storedProfileSetting(): Promise<{ rowNumber: number; profile: LineMessageTestProfile } | null> {
  const setting = (await listOperationalSettings()).find((item) => item.key === LINE_MESSAGE_TEST_PROFILE_SETTING_KEY);
  if (!setting) return null;
  return { rowNumber: setting.rowNumber, profile: parseLineMessageTestProfile(setting.value) };
}

function sameProfile(left: LineMessageTestProfile, right: LineMessageTestProfile): boolean {
  return JSON.stringify(parseLineMessageTestProfile(left)) === JSON.stringify(parseLineMessageTestProfile(right));
}

function profileUpdateRequest(profile: LineMessageTestProfile, sheetId: number, rowNumber: number) {
  const rowIndex = rowNumber - 1;
  return {
    updateCells: {
      range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 1, endColumnIndex: 2 },
      rows: [{ values: [stringCell(JSON.stringify(parseLineMessageTestProfile(profile)))] }],
      fields: "userEnteredValue",
    },
  };
}

function reservationRange(sheetId: number, rowNumber: number) {
  const rowIndex = rowNumber - 1;
  return { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: 1, endColumnIndex: 2 };
}

export async function getLineMessageTestProfile(): Promise<LineMessageTestProfile | null> {
  return (await storedProfileSetting())?.profile ?? null;
}

export async function saveLineMessageTestProfile(profile: LineMessageTestProfile): Promise<void> {
  const parsed = parseLineMessageTestProfile(profile);
  await upsertOperationalSetting(LINE_MESSAGE_TEST_PROFILE_SETTING_KEY, JSON.stringify(parsed));
}

export async function updateLineMessageTestProfileIfUnchanged({ expectedProfile, profile }: ProfileUpdateInput): Promise<boolean> {
  const expected = parseLineMessageTestProfile(expectedProfile);
  const next = parseLineMessageTestProfile(profile);
  const stored = await storedProfileSetting();
  if (!stored || !sameProfile(stored.profile, expected)) return false;
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const metadata = await settingsMetadata();
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [
        { addNamedRange: { namedRange: { name: stateReservationName(expected), range: reservationRange(metadata.sheetId, stored.rowNumber) } } },
        profileUpdateRequest(next, metadata.sheetId, stored.rowNumber),
      ] },
    });
    return true;
  } catch (error) {
    if (isLineReservationConflict(error)) return false;
    throw error;
  }
}

export async function claimLineMessageTestConnection({ expectedProfile, profile, tokenHash, lineUserId }: ClaimInput): Promise<LineConnectionClaimResult> {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error("LINE connection token hash is malformed");
  if (!/^U[a-f0-9]{32}$/.test(lineUserId)) throw new Error("LINE user ID is malformed");
  const expected = parseLineMessageTestProfile(expectedProfile);
  const linked = parseLineMessageTestProfile(profile);
  if (expected.lineLinkTokenHash !== tokenHash
    || linked.lineLinkTokenHash !== tokenHash
    || linked.lineUserId !== lineUserId
    || linked.lineLinkStatus !== "LINKED") {
    throw new Error("LINE connection claim does not match stored identity");
  }
  const stored = await storedProfileSetting();
  if (!stored || !sameProfile(stored.profile, expected)) return "STALE";
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const metadata = await settingsMetadata();
  const range = reservationRange(metadata.sheetId, stored.rowNumber);
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [
        { addNamedRange: { namedRange: { name: stateReservationName(expected), range } } },
        { addNamedRange: { namedRange: { name: lineReservationName("token", tokenHash), range } } },
        { addNamedRange: { namedRange: { name: lineReservationName("user", lineUserId), range } } },
        profileUpdateRequest(linked, metadata.sheetId, stored.rowNumber),
      ] },
    });
    return "CLAIMED";
  } catch (error) {
    if (!isLineReservationConflict(error)) throw error;
    const [current, refreshedMetadata] = await Promise.all([getLineMessageTestProfile(), settingsMetadata()]);
    if (current?.lineUserId === lineUserId && current.lineLinkStatus === "LINKED" && current.lineLinkTokenHash === tokenHash) return "ALREADY_LINKED";
    const userReserved = refreshedMetadata.namedRanges.some((item) => item.name === lineReservationName("user", lineUserId));
    if (userReserved || (current?.lineUserId && current.lineUserId !== lineUserId)) return "CONFLICT";
    return "STALE";
  }
}

export async function disconnectLineMessageTestConnection({ expectedProfile, profile }: ProfileUpdateInput): Promise<boolean> {
  const expected = parseLineMessageTestProfile(expectedProfile);
  const disconnected = parseLineMessageTestProfile(profile);
  const stored = await storedProfileSetting();
  if (!stored || !sameProfile(stored.profile, expected)) return false;
  const { sheets, spreadsheetId } = await getGoogleSheets();
  const metadata = await settingsMetadata();
  const userReservation = expected.lineUserId
    ? metadata.namedRanges.find((item) => item.name === lineReservationName("user", expected.lineUserId) && item.namedRangeId)
    : undefined;
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [
        { addNamedRange: { namedRange: { name: stateReservationName(expected), range: reservationRange(metadata.sheetId, stored.rowNumber) } } },
        profileUpdateRequest(disconnected, metadata.sheetId, stored.rowNumber),
        ...(userReservation?.namedRangeId ? [{ deleteNamedRange: { namedRangeId: userReservation.namedRangeId } }] : []),
      ] },
    });
    return true;
  } catch (error) {
    if (isLineReservationConflict(error)) return false;
    throw error;
  }
}
