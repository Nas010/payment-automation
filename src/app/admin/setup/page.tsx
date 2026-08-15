import { headers } from "next/headers";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-auth";
import { activateGoogleDriveFolderAction } from "@/app/admin/google-drive/actions";
import { GoogleDriveConnectionCard } from "@/components/admin/google-drive-connection-card";
import { RuntimeConfigForm } from "@/components/admin/runtime-config-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getInstallation } from "@/lib/installation/repository";
import { googleDriveConfig } from "@/lib/config";
import { getPendingWorkspaceConnection } from "@/lib/workspace/connection";
import { completeSetupAction, createOperationalWorkbookAction, createSlipFolderAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const session = await requireAdmin();
  const [installation, pending, requestHeaders] = await Promise.all([getInstallation(), getPendingWorkspaceConnection(), headers()]);
  if (!installation || installation.ownerGoogleSub !== session.sub) throw new Error("Installation owner could not be verified.");
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;
  const workbookReady = Boolean(pending?.spreadsheetId);
  const folderReady = Boolean(pending?.folderId);

  return <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-6 p-4 py-10 md:p-8">
    <div><p className="text-sm text-muted-foreground">Signed in as {session.email}</p><h1 className="text-3xl font-semibold tracking-tight">Set up your payment workspace</h1><p className="mt-2 text-muted-foreground">Your workbook and slip folder stay in your Google account. Setup can be resumed at any time.</p></div>
    <Card><CardHeader><CardTitle>1. Installation owner</CardTitle><CardDescription>The first verified Google account permanently owns this installation.</CardDescription></CardHeader><CardContent><span className="text-sm">Claimed by {installation.ownerEmail}</span></CardContent></Card>
    <Card><CardHeader><CardTitle>2. Google Workspace</CardTitle><CardDescription>Reconnect the owner account if authorization needs attention.</CardDescription></CardHeader><CardContent className="flex items-center justify-between gap-4"><span className="text-sm">{pending ? `Connected: ${pending.accountEmail}` : "Connection required"}</span><Link className={buttonVariants({ variant: "outline" })} href="/admin/google-drive/connect?intent=setup">{pending ? "Reconnect" : "Connect Google"}</Link></CardContent></Card>
    <Card><CardHeader><CardTitle>3. Database workbook</CardTitle><CardDescription>Create the operational workbook once. Completed installations cannot switch databases.</CardDescription></CardHeader><CardContent>{workbookReady ? <a className="text-sm font-medium text-primary underline" href={pending?.spreadsheetUrl} target="_blank" rel="noreferrer">Open {pending?.spreadsheetName}</a> : <form action={createOperationalWorkbookAction}><Button type="submit" disabled={!pending}>Create Coaching Payments workbook</Button></form>}</CardContent></Card>
    {workbookReady ? <div className="space-y-4">{!folderReady ? <Card><CardHeader><CardTitle>4. Private slip folder</CardTitle><CardDescription>Create the recommended folder or select an existing folder from Google Drive.</CardDescription></CardHeader><CardContent><form action={createSlipFolderAction}><Button type="submit" variant="outline">Create Coaching Payment Slips</Button></form></CardContent></Card> : null}<GoogleDriveConnectionCard status={{ connected: folderReady, accountEmail: pending?.accountEmail, folderName: pending?.folderName }} canConnect={Boolean(googleDriveConfig())} authorizationReady={Boolean(pending)} autoOpenPicker={false} initialError="" activateAction={activateGoogleDriveFolderAction} /></div> : null}
    {workbookReady && folderReady ? <Card><CardHeader><CardTitle>5. Business and payment settings</CardTitle><CardDescription>Step 6 runs QR, workbook, and folder checks. Step 7 marks setup complete and opens the dashboard.</CardDescription></CardHeader><CardContent><RuntimeConfigForm action={completeSetupAction} defaultBaseUrl={baseUrl} /></CardContent></Card> : null}
  </main>;
}
