import { LineIntegrationForm } from "@/components/admin/line-integration-form";
import { getSecretMetadata } from "@/lib/secrets/service";
import { listOperationalSettings } from "@/lib/sheets/settings";
import { saveAndTestLineCredentialsAction } from "../line-actions";
import { lineCredentialMetadata, validationMetadata } from "../line-settings";

export default async function LineSettingsPage() {
  const [settings, secretMetadata] = await Promise.all([listOperationalSettings(), getSecretMetadata()]);
  const validation = validationMetadata(settings.find((item) => item.key === "line_access_token_validation")?.value);

  return <LineIntegrationForm credentials={lineCredentialMetadata(secretMetadata)} validation={validation} action={saveAndTestLineCredentialsAction} />;
}
