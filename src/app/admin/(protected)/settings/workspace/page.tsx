import { activateGoogleDriveFolderAction } from "@/app/admin/google-drive/actions";
import { GoogleDriveConnectionCard } from "@/components/admin/google-drive-connection-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { googleDriveConfig } from "@/lib/config";
import { getActiveWorkspaceConnection } from "@/lib/workspace/connection";
import { testWorkspaceConnectionAction } from "../runtime-actions";

export default async function WorkspaceSettingsPage({ searchParams }: { searchParams?: Promise<{ workspace?: string; drive_error?: string }> }) {
  const [query, connection] = await Promise.all([searchParams, getActiveWorkspaceConnection()]);

  return <div className="flex flex-col gap-6">
    {connection ? <Card><CardHeader><CardTitle>Operational database</CardTitle><CardDescription>This workbook is fixed after setup.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-4 text-sm"><a className="font-medium text-primary underline" href={connection.spreadsheetUrl} target="_blank" rel="noreferrer">Open {connection.spreadsheetName}</a><a className="font-medium text-primary underline" href={connection.folderUrl} target="_blank" rel="noreferrer">Open {connection.folderName}</a><form action={testWorkspaceConnectionAction}><Button type="submit" variant="outline" size="sm">Test connection</Button></form></CardContent></Card> : null}
    <GoogleDriveConnectionCard status={connection ? { connected: true, accountEmail: connection.accountEmail, folderName: connection.folderName, validatedAt: connection.validatedAt } : { connected: false }} canConnect={Boolean(googleDriveConfig())} autoOpenPicker={query?.workspace === "reconnect_pending"} initialError={driveErrorMessage(query?.drive_error)} activateAction={activateGoogleDriveFolderAction} />
  </div>;
}

function driveErrorMessage(value: string | undefined): string {
  switch (value) {
    case "oauth_not_configured": return "Google Drive connection is not configured.";
    case "oauth_denied": return "Google Drive authorization was canceled.";
    case "oauth_missing_refresh_token": return "Google did not return offline access. Reconnect and approve access.";
    case "oauth_identity_invalid": return "Google identity could not be verified.";
    case "oauth_state_invalid":
    case "oauth_callback_invalid":
    case "oauth_exchange_failed":
    case "oauth_provider_error": return "Google Drive authorization failed. Reconnect and try again.";
    default: return "";
  }
}
