import { NextRequest } from "next/server";
import { activeClientSnapshotKey, previousMonth } from "@/lib/admin/dashboard-metrics";
import { bangkokDateKey } from "@/lib/date";
import { cronSecret } from "@/lib/config";
import { getInstallation } from "@/lib/installation/repository";
import { listClients } from "@/lib/sheets/clients";
import { upsertOperationalSetting } from "@/lib/sheets/settings";

export async function GET(request: NextRequest): Promise<Response> {
  const secret = cronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if ((await getInstallation())?.setupStatus !== "COMPLETE") return Response.json({ error: "Setup incomplete" }, { status: 503 });

  const today = bangkokDateKey();
  if (!today.endsWith("-01")) return Response.json({ skipped: true });

  const clients = await listClients();
  const activeClients = clients.filter((client) => client.active.toUpperCase() === "TRUE").length;
  const month = previousMonth(today.slice(0, 7));
  await upsertOperationalSetting(activeClientSnapshotKey(month), String(activeClients));
  return Response.json({ month, activeClients });
}
