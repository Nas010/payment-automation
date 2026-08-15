import { RuntimeConfigForm } from "@/components/admin/runtime-config-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { runtimeConfig } from "@/lib/runtime-config";
import { getSecretMetadata } from "@/lib/secrets/service";
import { saveRuntimeConfigAction } from "../runtime-actions";
import { lineCredentialMetadata } from "../line-settings";

export default async function BusinessSettingsPage() {
  const [config, secretMetadata] = await Promise.all([runtimeConfig(), getSecretMetadata()]);
  const credentials = lineCredentialMetadata(secretMetadata);

  return <Card>
    <CardHeader>
      <CardTitle>Business, payment, and LINE configuration</CardTitle>
      <CardDescription>Manage public application settings here. PromptPay changes must produce a valid QR preview before they can be saved.</CardDescription>
    </CardHeader>
    <CardContent>
      <RuntimeConfigForm action={saveRuntimeConfigAction} defaultBaseUrl={config.publicBaseUrl} initial={config} allowLineFeatures={credentials.every((credential) => credential.configured)} submitLabel="Save settings" />
    </CardContent>
  </Card>;
}
