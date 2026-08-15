import { PageHeader } from "@/components/admin/page-ui";
import { LineIntegrationForm, type LineCredentialMetadata } from "@/components/admin/line-integration-form";
import { LineDueTemplateForm } from "@/components/admin/line-due-template-form";
import { GoogleDriveConnectionCard } from "@/components/admin/google-drive-connection-card";
import { RuntimeConfigForm } from "@/components/admin/runtime-config-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { googleDriveConfig } from "@/lib/config";
import { runtimeConfig } from "@/lib/runtime-config";
import { getSecretMetadata } from "@/lib/secrets/service";
import { listOperationalSettings, resolveLineDueMessageProfiles } from "@/lib/sheets/settings";
import { getActiveWorkspaceConnection } from "@/lib/workspace/connection";
import { previewLineDueMessageProfileAction, resetLineDueMessageProfileAction, saveAndTestLineCredentialsAction, saveLineDueMessageProfileAction } from "./line-actions";
import { activateGoogleDriveFolderAction } from "@/app/admin/google-drive/actions";
import { saveRuntimeConfigAction, testWorkspaceConnectionAction } from "./runtime-actions";

export default async function SettingsPage({ searchParams }: { searchParams?: Promise<{ workspace?: string; drive_error?: string }> }) {
  const query = await searchParams;
  const [settings, secretMetadata, connection, config] = await Promise.all([
    listOperationalSettings(),
    getSecretMetadata(),
    getActiveWorkspaceConnection(),
    runtimeConfig(),
  ]);
  const credentials = lineCredentialMetadata(secretMetadata);
  const validation = validationMetadata(settings.find((item) => item.key === "line_access_token_validation")?.value);
  const dueProfiles = resolveLineDueMessageProfiles(settings);
  const driveError = driveErrorMessage(query?.drive_error);

  return <div className="flex flex-col gap-6">
    <PageHeader title="Settings" description="Business settings live in your workbook. Google and LINE secrets stay encrypted in the private key safe." />
    {connection ? <Card><CardHeader><CardTitle>Operational database</CardTitle><CardDescription>This workbook is fixed after setup.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-4 text-sm"><a className="font-medium text-primary underline" href={connection.spreadsheetUrl} target="_blank" rel="noreferrer">Open {connection.spreadsheetName}</a><a className="font-medium text-primary underline" href={connection.folderUrl} target="_blank" rel="noreferrer">Open {connection.folderName}</a><form action={testWorkspaceConnectionAction}><Button type="submit" variant="outline" size="sm">Test connection</Button></form></CardContent></Card> : null}
    <GoogleDriveConnectionCard status={connection ? { connected: true, accountEmail: connection.accountEmail, folderName: connection.folderName, validatedAt: connection.validatedAt } : { connected: false }} canConnect={Boolean(googleDriveConfig())} autoOpenPicker={query?.workspace === "reconnect_pending"} initialError={driveError} activateAction={activateGoogleDriveFolderAction} />
    <Card><CardHeader><CardTitle>Business and payment configuration</CardTitle><CardDescription>PromptPay changes must produce a valid QR preview before they can be saved.</CardDescription></CardHeader><CardContent><RuntimeConfigForm action={saveRuntimeConfigAction} defaultBaseUrl={config.publicBaseUrl} initial={config} allowLineFeatures={credentials.every((credential) => credential.configured)} submitLabel="Save settings" /></CardContent></Card>
    <LineIntegrationForm credentials={credentials} validation={validation} action={saveAndTestLineCredentialsAction} />
    <LineDueTemplateForm profiles={dueProfiles} messagingEnabled={config.lineMessagingEnabled} chatPaymentsEnabled={config.lineChatPaymentsEnabled} previewAction={previewLineDueMessageProfileAction} saveAction={saveLineDueMessageProfileAction} resetAction={resetLineDueMessageProfileAction} />
  </div>;
}

function lineCredentialMetadata(records: Awaited<ReturnType<typeof getSecretMetadata>>): LineCredentialMetadata[] {
  return (["line_channel_access_token", "line_channel_secret"] as const).map((keyName) => {
    const encrypted = records.find((record) => record.keyName === keyName);
    return encrypted ? { keyName, configured: true, source: "encrypted" as const, lastFour: encrypted.lastFour, updatedAt: encrypted.updatedAt } : { keyName, configured: false, source: "unconfigured" as const };
  });
}

function validationMetadata(value: string | undefined): { status: "VALID" | "FAILED"; validatedAt: string } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { status?: unknown; validatedAt?: unknown };
    if ((parsed.status === "VALID" || parsed.status === "FAILED") && typeof parsed.validatedAt === "string") return { status: parsed.status, validatedAt: parsed.validatedAt };
  } catch {}
  return undefined;
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
