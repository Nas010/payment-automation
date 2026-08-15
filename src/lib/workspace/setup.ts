import { setInstallationStatus } from "@/lib/installation/repository";
import { parseRuntimeConfig, runtimeConfigEntries, type RuntimeConfig } from "@/lib/runtime-config";
import { getPendingGoogleSheets } from "@/lib/sheets/client";
import { createOAuthDriveClient, testDriveFolderWrite, validateDriveFolder } from "@/lib/storage/drive-client";
import {
  activatePendingWorkspaceConnection,
  getPendingWorkspaceConnection,
} from "./connection";
import { validateOperationalWorkbook } from "./workbook";
import { DEFAULT_LINE_DUE_PROFILES, LINE_DUE_PROFILE_SETTING_KEYS } from "@/lib/line/message-profile";

type SetupDependencies = {
  getPendingWorkspaceConnection: typeof getPendingWorkspaceConnection;
  validateWorkbook: (spreadsheetId: string) => Promise<unknown>;
  validateFolder: (folderId: string) => Promise<unknown>;
  probeFolder: (folderId: string) => Promise<void>;
  writeSettings: (config: RuntimeConfig) => Promise<void>;
  activateConnection: typeof activatePendingWorkspaceConnection;
  setInstallationStatus: typeof setInstallationStatus;
};

async function writeStagedSettings(config: RuntimeConfig): Promise<void> {
  const { sheets, connection } = await getPendingGoogleSheets();
  if (!connection.spreadsheetId) throw new Error("Operational workbook has not been created.");
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: connection.spreadsheetId, range: "Settings!A:B" });
  const rows = response.data.values ?? [];
  const existing = new Map(rows.slice(1).map((row, index) => [String(row[0] ?? ""), index + 2]));
  let nextRow = Math.max(2, rows.length + 1);
  const entries = [
    ...runtimeConfigEntries(config),
    { key: LINE_DUE_PROFILE_SETTING_KEYS.ONE_TIME, value: JSON.stringify(DEFAULT_LINE_DUE_PROFILES.ONE_TIME) },
    { key: LINE_DUE_PROFILE_SETTING_KEYS.INSTALLMENTS, value: JSON.stringify(DEFAULT_LINE_DUE_PROFILES.INSTALLMENTS) },
    { key: "dashboard_collected_delta_display", value: "absolute" },
  ];
  const data = entries.map((entry) => {
    const rowNumber = existing.get(entry.key) ?? nextRow++;
    return { range: `Settings!A${rowNumber}:B${rowNumber}`, values: [[entry.key, entry.value]] };
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: connection.spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}

async function defaultDependencies(): Promise<SetupDependencies> {
  const pending = await getPendingWorkspaceConnection();
  if (!pending) throw new Error("Google Workspace authorization is not staged.");
  const drive = createOAuthDriveClient(pending);
  return {
    getPendingWorkspaceConnection,
    validateWorkbook: async (spreadsheetId) => {
      const staged = await getPendingGoogleSheets();
      return validateOperationalWorkbook(spreadsheetId, staged.sheets);
    },
    validateFolder: async (folderId) => validateDriveFolder(folderId, { drive, permissionMessage: "Connected Google account needs Editor access to this folder." }),
    probeFolder: async (folderId) => testDriveFolderWrite(folderId, drive),
    writeSettings: writeStagedSettings,
    activateConnection: activatePendingWorkspaceConnection,
    setInstallationStatus,
  };
}

export async function completeWorkspaceSetup(
  input: { ownerGoogleSub: string; config: RuntimeConfig },
  injectedDependencies?: SetupDependencies,
): Promise<void> {
  const dependencies = injectedDependencies ?? await defaultDependencies();
  const pending = await dependencies.getPendingWorkspaceConnection();
  if (!pending) throw new Error("Google Workspace authorization is not staged.");
  if (pending.accountGoogleSub !== input.ownerGoogleSub) throw new Error("Google Workspace account does not match the installation owner.");
  if (!pending.spreadsheetId || !pending.folderId) throw new Error("Google Workspace setup is incomplete.");
  const config = parseRuntimeConfig(input.config);
  await dependencies.validateWorkbook(pending.spreadsheetId);
  await dependencies.validateFolder(pending.folderId);
  await dependencies.probeFolder(pending.folderId);
  await dependencies.writeSettings(config);
  await dependencies.activateConnection({ workbookProbePassed: true, folderProbePassed: true });
  await dependencies.setInstallationStatus(input.ownerGoogleSub, "COMPLETE");
}
