import Link from "next/link";
import { CalendarClockIcon, ReceiptTextIcon, ScrollTextIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { ClientManualPayments } from "@/components/admin/client-manual-payments";
import { ClientBillingActions } from "@/components/admin/client-billing-actions";
import { ClientPackageAssignments } from "@/components/admin/client-package-assignments";
import { ClientAvatar } from "@/components/admin/client-avatar";
import { LineLinkActions } from "@/components/admin/line-link-actions";
import { lineLinkStatus } from "@/components/admin/line-link-state";
import { EmptyTableRow, MetricCard, PageHeader } from "@/components/admin/page-ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildClientBillingSummary } from "@/lib/admin/client-billing";
import { buildPackageAssignments } from "@/lib/plans/assignment-lifecycle";
import { formatDate, formatDateTime } from "@/lib/date";
import { renderClientLineWelcomeMessage } from "@/lib/line/welcome-message";
import { formatThb, parseSatang } from "@/lib/money";
import { runtimeConfig } from "@/lib/runtime-config";
import { listAuditRecords } from "@/lib/sheets/audit";
import { listClients } from "@/lib/sheets/clients";
import { listPayments } from "@/lib/sheets/payments";
import { listSchedules } from "@/lib/sheets/schedules";
import { getLineWelcomeTemplate, listPackages } from "@/lib/sheets/settings";
import { cancelManualPaymentAction, removeManualPaymentAction, assignPackageAction, changePackageAssignmentAction, createManualPaymentAction, deletePackageAssignmentAction, disconnectLineAction, endPackageAssignmentAction, pausePackageAssignmentAction, renewLineConnectionAction, resumePackageAssignmentAction } from "../../actions";

export default async function ClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const [clients, schedules, payments, audit, packages, welcomeTemplate, config] = await Promise.all([listClients(), listSchedules(), listPayments(), listAuditRecords(), listPackages(), getLineWelcomeTemplate(), runtimeConfig()]);
  const client = clients.find((item) => item.client_id === clientId);
  if (!client) notFound();

  const clientSchedules = schedules.filter((item) => item.client_id === clientId);
  const clientPayments = payments.filter((item) => item.client_id === clientId);
  const clientAudit = audit.filter((item) => item.client_id === clientId);
  const activePackages = packages.filter((item) => item.active.toUpperCase() === "TRUE");
  const packageAssignments = buildPackageAssignments(clientSchedules, new Set(packages.map((item) => item.package_name)));
  const manualAssignments = buildPackageAssignments(clientSchedules, new Set(), "MANUAL");
  const manualActionsBySchedule = new Map(manualAssignments.map((assignment) => [assignment.schedules[0].schedule_id, assignment]));
  const summary = buildClientBillingSummary(clientSchedules.filter((item) => item.status !== "DELETED"));
  const liffId = config.lineLiffId;
  const welcomeMessage = liffId ? renderClientLineWelcomeMessage({ client, template: welcomeTemplate, businessName: config.businessDisplayName, liffId }) : "";

  return <div className="flex flex-col gap-6">
    <PageHeader title={<span className="flex items-center gap-3"><ClientAvatar clientName={client.client_name} lineDisplayName={client.line_display_name} pictureUrl={client.line_picture_url} size="lg" /><span>{client.client_name}</span></span>} description={`${client.package_name} · ${client.line_display_name || client.line_user_id || "No LINE profile"}`} />
    <section className="grid gap-3 sm:grid-cols-4">
      <MetricCard label="Total value" value={formatThb(summary.totalSatang)} />
      <MetricCard label="Paid" value={formatThb(summary.paidSatang)} />
      <MetricCard label="Outstanding" value={formatThb(summary.outstandingSatang)} />
      <MetricCard label="Next due" value={formatDate(summary.nextDueDate)} />
    </section>

    <ClientPackageAssignments
      assignments={packageAssignments}
      packages={activePackages}
      changePackageAssignmentAction={changePackageAssignmentAction.bind(null, clientId)}
      pausePackageAssignmentAction={pausePackageAssignmentAction.bind(null, clientId)}
      resumePackageAssignmentAction={resumePackageAssignmentAction.bind(null, clientId)}
      endPackageAssignmentAction={endPackageAssignmentAction.bind(null, clientId)}
      deletePackageAssignmentAction={deletePackageAssignmentAction.bind(null, clientId)}
    />

    <ClientBillingActions
      packages={activePackages}
      assignPackageAction={assignPackageAction.bind(null, clientId)}
      createManualPaymentAction={createManualPaymentAction.bind(null, clientId)}
    />

    <Card>
      <CardHeader><CardTitle>LINE connection</CardTitle><CardDescription>Copy the personalized welcome message into this client&apos;s existing LINE chat.</CardDescription></CardHeader>
      <CardContent><LineLinkActions clientId={client.client_id} status={lineLinkStatus(client)} message={welcomeMessage ?? ""} expiresAt={client.line_link_token_expires_at} displayName={client.line_display_name} linkedAt={client.line_linked_at} error={client.line_link_error} renewAction={renewLineConnectionAction} disconnectAction={disconnectLineAction} /></CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Payment schedule</CardTitle><CardDescription>Package installments and custom charges, ordered by due date.</CardDescription></CardHeader>
      <CardContent><div className="overflow-x-auto"><Table>
        <TableHeader><TableRow><TableHead>Plan or charge</TableHead><TableHead>#</TableHead><TableHead>Due date</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Payment</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
        <TableBody>{summary.orderedSchedules.length ? summary.orderedSchedules.map((item) => <TableRow key={item.schedule_id}>
          <TableCell className="font-medium">{item.package_name}</TableCell>
          <TableCell>{item.installment_number}/{item.installment_count}</TableCell>
          <TableCell>{formatDate(item.due_date)}</TableCell>
          <TableCell>{formatThb(parseSatang(item.amount_thb) ?? 0)}</TableCell>
          <TableCell><StatusBadge status={item.status} /></TableCell>
          <TableCell>{item.payment_id ? <Link className="underline" href={`/admin/payments/${item.payment_id}`}>Open</Link> : "—"}</TableCell>
          <TableCell>{manualActionsBySchedule.has(item.schedule_id) ? <ClientManualPayments assignments={[manualActionsBySchedule.get(item.schedule_id)!]} cancelAction={cancelManualPaymentAction.bind(null, clientId)} removeAction={removeManualPaymentAction.bind(null, clientId)} /> : "—"}</TableCell>
        </TableRow>) : <EmptyTableRow colSpan={7} icon={<CalendarClockIcon />} title="No payments scheduled" description="Assign a package or add a manual payment above." />}</TableBody>
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
