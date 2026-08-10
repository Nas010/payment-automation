"use server";

import { redirect } from "next/navigation";
import { clearAdminSession, createAdminSession, verifyAdminSecret } from "@/lib/admin-auth";

export async function loginAction(formData: FormData): Promise<void> {
  const secret = String(formData.get("admin_secret") ?? "");
  if (!verifyAdminSecret(secret)) redirect("/admin/login?error=invalid");
  await createAdminSession();
  redirect("/admin/dashboard");
}

export async function logoutAction(): Promise<void> {
  await clearAdminSession();
  redirect("/admin/login");
}
