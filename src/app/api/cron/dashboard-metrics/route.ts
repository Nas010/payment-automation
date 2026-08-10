import { NextRequest } from "next/server";
import { activeClientSnapshotKey, previousMonth } from "@/lib/admin/dashboard-metrics";
import { bangkokDateKey } from "@/lib/date";
import { serverConfig } from "@/lib/config";
import { listClients } from "@/lib/sheets/clients";
import { upsertOperationalSetting } from "@/lib/sheets/settings";

export async function GET(request: NextRequest): Promise<Response> {
  const config = serverConfig();
  if (!config.cronSecret || request.headers.get("authorization") !== `Bearer ${config.cronSecret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const today = bangkokDateKey();
  if (!today.endsWith("-01")) return Response.json({ skipped: true });

  const clients = await listClients();
  const activeClients = clients.filter((client) => client.active.toUpperCase() === "TRUE").length;
  const month = previousMonth(today.slice(0, 7));
  await upsertOperationalSetting(activeClientSnapshotKey(month), String(activeClients));
  return Response.json({ month, activeClients });
}
