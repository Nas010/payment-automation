import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listOperationalSettings } from "@/lib/sheets/settings";
import { getSecretMetadata } from "@/lib/secrets/service";
import { lineConfig } from "@/lib/config";
import { saveOperationalSettingAction } from "../actions";
import { LineIntegrationForm, type LineCredentialMetadata } from "@/components/admin/line-integration-form";
import { saveAndTestLineCredentialsAction } from "./line-actions";
import { EmptyTableRow, PageHeader } from "@/components/admin/page-ui";
import { Settings2Icon } from "lucide-react";

export default async function SettingsPage() { const [settings, secretMetadata] = await Promise.all([listOperationalSettings(), getSecretMetadata()]); const validation = validationMetadata(settings.find((item) => item.key === "line_access_token_validation")?.value); const credentials = lineCredentialMetadata(secretMetadata); const visibleSettings = settings.filter((item) => item.key !== "line_access_token_validation"); return <div className="flex flex-col gap-6"><PageHeader title="Settings" description="Operational values stored in Sheets. Secrets remain server-side." /><LineIntegrationForm credentials={credentials} validation={validation} action={saveAndTestLineCredentialsAction} /><Card><CardHeader><CardTitle>Operational configuration</CardTitle><CardDescription>Values update the connected workbook, not deployment secrets.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Value</TableHead></TableRow></TableHeader><TableBody>{visibleSettings.length ? visibleSettings.map((item) => <TableRow key={item.rowNumber}><TableCell className="font-medium">{item.key}</TableCell><TableCell className="max-w-xl truncate">{item.value}</TableCell></TableRow>) : <EmptyTableRow colSpan={2} icon={<Settings2Icon />} title="No operational settings" description="Add the first workbook setting below." />}</TableBody></Table></CardContent></Card><Card><CardHeader><CardTitle>Add or update setting</CardTitle><CardDescription>Existing keys are updated in place.</CardDescription></CardHeader><CardContent><form action={saveOperationalSettingAction}><FieldGroup className="grid gap-4 sm:grid-cols-[1fr_2fr_auto]"><Field><FieldLabel htmlFor="key">Key</FieldLabel><Input id="key" name="key" required placeholder="business_display_name" /></Field><Field><FieldLabel htmlFor="value">Value</FieldLabel><Input id="value" name="value" required /></Field><div className="flex items-end"><Button type="submit">Save setting</Button></div></FieldGroup></form></CardContent></Card></div>; }

function lineCredentialMetadata(records: Awaited<ReturnType<typeof getSecretMetadata>>): LineCredentialMetadata[] {
  const config = lineConfig();
  return [
    metadataFor("line_channel_access_token", config.channelAccessToken, records),
    metadataFor("line_channel_secret", config.channelSecret, records),
  ];
}

function metadataFor(keyName: LineCredentialMetadata["keyName"], environmentValue: string, records: Awaited<ReturnType<typeof getSecretMetadata>>): LineCredentialMetadata {
  const encrypted = records.find((record) => record.keyName === keyName);
  if (encrypted) return { keyName, configured: true, source: "encrypted", lastFour: encrypted.lastFour, updatedAt: encrypted.updatedAt };
  if (environmentValue && environmentValue !== "CONFIG_REQUIRED") return { keyName, configured: true, source: "environment" };
  return { keyName, configured: false, source: "unconfigured" };
}

function validationMetadata(value: string | undefined): { status: "VALID" | "FAILED"; validatedAt: string } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { status?: unknown; validatedAt?: unknown };
    if ((parsed.status === "VALID" || parsed.status === "FAILED") && typeof parsed.validatedAt === "string") return { status: parsed.status, validatedAt: parsed.validatedAt };
  } catch {}
  return undefined;
}
