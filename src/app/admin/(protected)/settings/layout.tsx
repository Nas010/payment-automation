import { PageHeader } from "@/components/admin/page-ui";
import { SettingsNavigation } from "@/components/admin/settings-navigation";
import { Separator } from "@/components/ui/separator";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6">
    <PageHeader title="Settings" description="Business settings live in your workbook. Google and LINE secrets stay encrypted in the private key safe." />
    <Separator />
    <div className="flex flex-col gap-6 lg:flex-row">
      <SettingsNavigation />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  </div>;
}
