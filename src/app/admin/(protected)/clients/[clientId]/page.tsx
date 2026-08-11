import Link from "next/link";
import { CalendarClockIcon, ReceiptTextIcon, ScrollTextIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { ClientBillingActions } from "@/components/admin/client-billing-actions";
import { LineLinkActions } from "@/components/admin/line-link-actions";
import { lineLinkStatus } from "@/components/admin/line-link-state";
import { EmptyTableRow, MetricCard, PageHeader } from "@/components/admin/page-ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildClientBillingSummary } from "@/lib/admin/client-billing";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatThb, parseSatang } from "@/lib/money";
import { listAuditRecords } from "@/lib/sheets/audit";
import { listClients } from "@/lib/sheets/clients";
import { listPayments } from "@/lib/sheets/payments";
import { listSchedules } from "@/lib/sheets/schedules";
import { listPackages } from "@/lib/sheets/settings";
import { assignPackageAction, createManualPaymentAction, disconnectLineAction, renewLineLinkCodeAction } from "../../actions";

export default async function ClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const [clients, schedules, payments, audit, packages] = await Promise.all([listClients(), listSchedules(), listPayments(), listAuditRecords(), listPackages()]);
  const client = clients.find((item) => item.client_id === clientId);
  if (!client) notFound();

  const clientSchedules = schedules.filter((item) => item.client_id === clientId);
  const clientPayments = payments.filter((item) => item.client_id === clientId);
  const clientAudit = audit.filter((item) => item.client_id === clientId);
  const activePackages = packages.filter((item) => item.active.toUpperCase() === "TRUE");
  const summary = buildClientBillingSummary(clientSchedules);

  return <div className="flex flex-col gap-6">
    <PageHeader title={client.client_name} description={`${client.package_name} · ${client.line_display_name || client.line_user_id || "No LINE profile"}`} />
    <section className="grid gap-3 sm:grid-cols-4">
      <MetricCard label="Total value" value={formatThb(summary.totalSatang)} />
      <MetricCard label="Paid" value={formatThb(summary.paidSatang)} />
      <MetricCard label="Outstanding" value={formatThb(summary.outstandingSatang)} />
      <MetricCard label="Next due" value={formatDate(summary.nextDueDate)} />
    </section>

    <ClientBillingActions
      packages={activePackages}
      assignPackageAction={assignPackageAction.bind(null, clientId)}
      createManualPaymentAction={createManualPaymentAction.bind(null, clientId)}
    />

    <Card>
      <CardHeader><CardTitle>LINE connection</CardTitle><CardDescription>Use a one-time code to link this client&apos;s LINE account.</CardDescription></CardHeader>
      <CardContent><LineLinkActions clientId={client.client_id} status={lineLinkStatus(client)} code={client.line_link_code} instruction={client.line_link_message} expiresAt={client.line_link_code_expires_at} displayName={client.line_display_name} linkedAt={client.line_linked_at} error={client.line_link_error} renewAction={renewLineLinkCodeAction} disconnectAction={disconnectLineAction} /></CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Payment schedule</CardTitle><CardDescription>Package installments and custom charges, ordered by due date.</CardDescription></CardHeader>
      <CardContent><div className="overflow-x-auto"><Table>
        <TableHeader><TableRow><TableHead>Plan or charge</TableHead><TableHead>#</TableHead><TableHead>Due date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Payment</TableHead></TableRow></TableHeader>
        <TableBody>{summary.orderedSchedules.length ? summary.orderedSchedules.map((item) => <TableRow key={item.schedule_id}>
          <TableCell className="font-medium">{item.package_name}</TableCell>
          <TableCell>{item.installment_number}/{item.installment_count}</TableCell>
          <TableCell>{formatDate(item.due_date)}</TableCell>
          <TableCell>{formatThb(parseSatang(item.amount_thb) ?? 0)}</TableCell>
          <TableCell><StatusBadge status={item.status} /></TableCell>
          <TableCell>{item.payment_id ? <Link className="underline" href={`/admin/payments/${item.payment_id}`}>Open</Link> : "—"}</TableCell>
        </TableRow>) : <EmptyTableRow colSpan={6} icon={<CalendarClockIcon />} title="No payments scheduled" description="Assign a package or add a manual payment above." />}</TableBody>
      </Table></div></CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
      <CardContent>{clientAudit.length ? <div className="flex flex-col gap-2 text-sm">{clientAudit.map((item) => <p key={item.rowNumber}><span className="font-medium">{item.action.replaceAll("_", " ")}</span> · {item.reason} <span className="text-muted-foreground">{formatDateTime(item.timestamp)}</span></p>)}</div> : <EmptyPanel icon={<ScrollTextIcon />} title="No activity yet" description="Package and payment changes will appear here." />}</CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
      <CardContent>{clientPayments.length ? <div className="flex flex-col gap-2 text-sm">{clientPayments.map((item) => <Link key={item.payment_id} href={`/admin/payments/${item.payment_id}`} className="rounded-lg border p-3 hover:bg-muted/50">{formatDate(item.due_date)} · {formatThb(parseSatang(item.amount_thb) ?? 0)} · <StatusBadge status={item.status} /></Link>)}</div> : <EmptyPanel icon={<ReceiptTextIcon />} title="No payment links yet" description="Links appear when scheduled payments reach their due date." />}</CardContent>
    </Card>
  </div>;
}

function EmptyPanel({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <Empty className="border-0 py-8"><EmptyHeader><EmptyMedia variant="icon">{icon}</EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader></Empty>;
}
