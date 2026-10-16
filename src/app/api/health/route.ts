import { requiredConfiguration } from "@/lib/config";
import { getInstallation } from "@/lib/installation/repository";
import { runtimeConfig } from "@/lib/runtime-config";
import { getGoogleSheets } from "@/lib/sheets/client";
import { createOAuthDriveClient, validateDriveFolder } from "@/lib/storage/drive-client";
import { getActiveWorkspaceConnection } from "@/lib/workspace/connection";

type Check = "ready" | "missing" | "attention";

export async function GET(): Promise<Response> {
  const checks: Record<"bootstrap" | "owner" | "workspace" | "workbook" | "folder" | "business", Check> = {
    bootstrap: requiredConfiguration().length ? "missing" : "ready",
    owner: "missing",
    workspace: "missing",
    workbook: "missing",
    folder: "missing",
    business: "missing",
  };
  let installation = null;
  try { installation = await getInstallation(); checks.owner = installation ? "ready" : "missing"; } catch { checks.bootstrap = "attention"; }
  let connection = null;
  try { connection = await getActiveWorkspaceConnection(); checks.workspace = connection ? "ready" : "missing"; } catch { checks.workspace = "attention"; }
  if (connection) {
    try { const { sheets, spreadsheetId } = await getGoogleSheets(); await sheets.spreadsheets.get({ spreadsheetId, fields: "spreadsheetId" }); checks.workbook = "ready"; } catch { checks.workbook = "attention"; }
    try { await validateDriveFolder(connection.folderId, { drive: createOAuthDriveClient(connection), permissionMessage: "Folder access needs attention." }); checks.folder = "ready"; } catch { checks.folder = "attention"; }
    try { await runtimeConfig(); checks.business = "ready"; } catch { checks.business = "attention"; }
  }
  const ready = installation?.setupStatus === "COMPLETE" && Object.values(checks).every((value) => value === "ready");
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  const revision = commit && /^[a-f0-9]{40}$/.test(commit) ? commit : null;
  return Response.json({ ok: true, status: ready ? "ready" : "needs_configuration", checks, revision });
}
