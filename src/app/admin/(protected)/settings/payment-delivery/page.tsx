import { LineTermsImageForm } from "@/components/admin/line-terms-image-form";
import { activeLineTermsImageVersion, lineTermsImagePath, parseLineTermsImageState } from "@/lib/line/terms-image";
import { listOperationalSettings } from "@/lib/sheets/settings";
import { getActiveWorkspaceConnection } from "@/lib/workspace/connection";
import { uploadLineTermsImageAction } from "../terms-image-actions";

export default async function PaymentDeliverySettingsPage() {
  const [settings, connection] = await Promise.all([listOperationalSettings(), getActiveWorkspaceConnection()]);
  let image: { previewUrl: string; uploadedAt: string } | null = null;
  let error = "";

  try {
    const active = activeLineTermsImageVersion(parseLineTermsImageState(settings));
    image = active ? { previewUrl: lineTermsImagePath(active.publicToken), uploadedAt: active.uploadedAt } : null;
  } catch {
    error = "T&S image configuration needs attention.";
  }

  return <LineTermsImageForm image={image} driveConnected={Boolean(connection)} error={error} action={uploadLineTermsImageAction} />;
}
