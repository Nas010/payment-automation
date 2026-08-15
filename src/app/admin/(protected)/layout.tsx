import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdmin } from "@/lib/admin-auth";
import { Toaster } from "@/components/ui/sonner";
import { getInstallation } from "@/lib/installation/repository";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const installation = await getInstallation();
  if (installation?.setupStatus !== "COMPLETE") redirect("/admin/setup");
  return <AdminShell>{children}<Toaster /></AdminShell>;
}
