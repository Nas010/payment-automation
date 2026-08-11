import { Settings2Icon } from "lucide-react";
import { EmptyTableRow, PageHeader } from "@/components/admin/page-ui";
import { LineIntegrationForm, type LineCredentialMetadata } from "@/components/admin/line-integration-form";
import { LineDueTemplateForm } from "@/components/admin/line-due-template-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseDashboardCollectedDeltaDisplay } from "@/lib/admin/dashboard-metrics";
import { lineChatPaymentsEnabled, lineConfig, lineMessagingEnabled } from "@/lib/config";
import { DEFAULT_LINE_DUE_TEMPLATE } from "@/lib/line/message-template";
import { getSecretMetadata } from "@/lib/secrets/service";
import { listOperationalSettings } from "@/lib/sheets/settings";
import { saveDashboardDisplaySettingsAction, saveOperationalSettingAction } from "../actions";
import { previewLineDueTemplateAction, resetLineDueTemplateAction, saveAndTestLineCredentialsAction, saveLineDueTemplateAction } from "./line-actions";

export default async function SettingsPage() {
  const [settings, secretMetadata] = await Promise.all([listOperationalSettings(), getSecretMetadata()]);
  const collectedDeltaDisplay = parseDashboardCollectedDeltaDisplay(settings);
  const validation = validationMetadata(settings.find((item) => item.key === "line_access_token_validation")?.value);
  const credentials = lineCredentialMetadata(secretMetadata);
  const dueTemplate = settings.find((item) => item.key === "line_due_message_template")?.value || DEFAULT_LINE_DUE_TEMPLATE;
  const visibleSettings = settings.filter((item) => item.key !== "line_access_token_validation" && item.key !== "line_due_message_template");

  return <div className="flex flex-col gap-6">
    <PageHeader title="Settings" description="Operational values are stored in Sheets. Secrets remain server-side." />
    <LineIntegrationForm credentials={credentials} validation={validation} action={saveAndTestLineCredentialsAction} />
    <LineDueTemplateForm template={dueTemplate} messagingEnabled={lineMessagingEnabled()} chatPaymentsEnabled={lineChatPaymentsEnabled()} previewAction={previewLineDueTemplateAction} saveAction={saveLineDueTemplateAction} resetAction={resetLineDueTemplateAction} />
    <Card>
      <CardHeader><CardTitle>Dashboard display</CardTitle><CardDescription>Choose how the collected-month comparison is described in the dashboard trend tooltip.</CardDescription></CardHeader>
      <CardContent><form action={saveDashboardDisplaySettingsAction}><FieldGroup><Field><FieldLabel htmlFor="collected_delta_display">Collected month-over-month change</FieldLabel><Select name="collected_delta_display" defaultValue={collectedDeltaDisplay}><SelectTrigger id="collected_delta_display"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="absolute">Absolute THB amount</SelectItem><SelectItem value="percentage">Percentage change</SelectItem></SelectGroup></SelectContent></Select></Field><Button type="submit">Save dashboard display</Button></FieldGroup></form></CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Operational configuration</CardTitle><CardDescription>Values update the connected workbook, not deployment secrets.</CardDescription></CardHeader>
      <CardContent><Table><TableHeader><TableRow><TableHead>Key</TableHead><TableHead>Value</TableHead></TableRow></TableHeader><TableBody>{visibleSettings.length ? visibleSettings.map((item) => <TableRow key={item.rowNumber}><TableCell className="font-medium">{item.key}</TableCell><TableCell className="max-w-xl truncate">{item.value}</TableCell></TableRow>) : <EmptyTableRow colSpan={2} icon={<Settings2Icon />} title="No operational settings" description="Add the first workbook setting below." />}</TableBody></Table></CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Add or update setting</CardTitle><CardDescription>Existing keys are updated in place.</CardDescription></CardHeader>
      <CardContent><form action={saveOperationalSettingAction}><FieldGroup className="grid gap-4 sm:grid-cols-[1fr_2fr_auto]"><Field><FieldLabel htmlFor="key">Key</FieldLabel><Input id="key" name="key" required placeholder="business_display_name" /></Field><Field><FieldLabel htmlFor="value">Value</FieldLabel><Input id="value" name="value" required /></Field><div className="flex items-end"><Button type="submit">Save setting</Button></div></FieldGroup></form></CardContent>
    </Card>
  </div>;
}

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
