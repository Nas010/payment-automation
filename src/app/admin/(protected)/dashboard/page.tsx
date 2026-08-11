import Link from "next/link";
import { CalendarClockIcon } from "lucide-react";
import { MetricTrend } from "@/components/admin/metric-trend";
import { EmptyTableRow, MetricCard, PageHeader } from "@/components/admin/page-ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseDashboardCollectedDeltaDisplay } from "@/lib/admin/dashboard-metrics";
import { getAdminDashboard, bangkokToday } from "@/lib/admin/queries";
import { adminWorkbookAvailability } from "@/lib/admin-availability";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatRoundedThb, formatThb } from "@/lib/money";
import { generateDueLinksAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let dashboard;
  try {
    dashboard = await getAdminDashboard();
  } catch {
    const state = adminWorkbookAvailability();
    return <><h1 className="text-2xl font-semibold">Workbook unavailable</h1><Alert className="mt-6"><AlertTitle>Connect workbook to continue</AlertTitle><AlertDescription>{state.missing.length ? `Configure: ${state.missing.join(", ")}.` : "Check service-account access to your configured workbook."}</AlertDescription></Alert></>;
  }

  const collectedDeltaDisplay = parseDashboardCollectedDeltaDisplay(dashboard.settings);
  const metrics = [
    {
      label: "Active clients",
      value: String(dashboard.activeClients),
      trend: dashboard.activeClientsComparison ? <MetricTrend comparison={dashboard.activeClientsComparison} label="Active clients" delta={String(Math.abs(dashboard.activeClientsComparison.delta))} /> : undefined,
    },
    { label: "Due today", value: String(dashboard.dueToday) },
    { label: "Overdue", value: String(dashboard.overdue) },
    { label: "Needs review", value: String(dashboard.needsReview) },
    {
      label: "Collected this month",
      value: formatThb(dashboard.collectedThisMonthSatang),
      trend: dashboard.collectedComparison ? <MetricTrend comparison={dashboard.collectedComparison} label="Collected this month" delta={collectedDelta(dashboard.collectedComparison.delta, dashboard.collectedComparison.previous, collectedDeltaDisplay)} /> : undefined,
    },
  ];
  const actionRequired = dashboard.upcoming.filter((item) => item.due_date <= bangkokToday() || item.status === "REVIEW" || item.status === "FLAGGED").slice(0, 6);

  return <div className="flex flex-col gap-6"><PageHeader title="Dashboard" actions={<><Button nativeButton={false} variant="outline" render={<Link href="/admin/clients/new" />}>Add client</Button><form action={generateDueLinksAction}><Button type="submit">Generate due links</Button></form></>} /><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</section><section className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle>Action required</CardTitle><CardDescription>Overdue or unresolved items.</CardDescription></CardHeader><CardContent><ScheduleTable items={actionRequired} empty="No action required." /></CardContent></Card><Card><CardHeader><CardTitle>Recent activity</CardTitle><CardDescription>Latest payment and schedule changes.</CardDescription></CardHeader><CardContent><div className="flex flex-col gap-2">{dashboard.payments.slice(0, 5).map((payment) => <Link key={payment.payment_id} href={`/admin/payments/${payment.payment_id}`} className="rounded-lg border bg-background p-3 text-sm transition-colors hover:bg-muted"><p className="font-medium">{payment.client_name}</p><p className="mt-1 text-muted-foreground">{payment.status.replaceAll("_", " ")} · {formatDateTime(payment.updated_at || payment.created_at)}</p></Link>)}</div></CardContent></Card></section><Card><CardHeader><CardTitle>Upcoming schedule</CardTitle><CardDescription>{formatThb(dashboard.outstandingSatang)} outstanding across scheduled items.</CardDescription></CardHeader><CardContent><ScheduleTable items={dashboard.upcoming.slice(0, 12)} empty="No upcoming schedule items." scrollable /></CardContent></Card></div>;
}

function collectedDelta(delta: number, previous: number, display: "absolute" | "percentage"): string {
  if (display === "percentage" && previous !== 0) return `${(Math.abs(delta / previous) * 100).toFixed(1)}%`;
  return formatRoundedThb(Math.abs(delta));
}

function ScheduleTable({ items, empty, scrollable = false }: { items: { schedule_id: string; client_id: string; client_name: string; due_date: string; package_name: string; installment_number: string; installment_count: string; amount_thb: string; status: string; payment_id: string }[]; empty: string; scrollable?: boolean }) { return <div className={scrollable ? "max-h-[28rem] overflow-auto" : "overflow-x-auto"}><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Due</TableHead><TableHead>Package</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{items.length ? items.map((item) => <TableRow key={item.schedule_id}><TableCell><Link className="font-medium hover:underline" href={`/admin/clients/${item.client_id}`}>{item.client_name}</Link></TableCell><TableCell>{formatDate(item.due_date)}</TableCell><TableCell>{item.package_name}</TableCell><TableCell>{formatThb(Number(item.amount_thb.replace(/[^0-9.]/g, "")) * 100)}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell></TableRow>) : <EmptyTableRow colSpan={5} icon={<CalendarClockIcon />} title={empty} description="Schedule items appear here when they need attention." />}</TableBody></Table></div>; }
