import type { Metadata } from "next";
import { LineConnectClient } from "@/components/line/line-connect-client";
import { runtimeConfig } from "@/lib/runtime-config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect LINE", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function LineConnectPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  let liffId = "";
  try {
    liffId = (await runtimeConfig()).lineLiffId;
  } catch {}
  return <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
    <LineConnectClient liffId={liffId} connectionToken={token} />
  </main>;
}
