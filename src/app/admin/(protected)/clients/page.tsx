import Link from "next/link";
import { SearchIcon, UsersRoundIcon } from "lucide-react";
import { formatClientDirectoryCount, formatPaymentProgress } from "@/lib/admin/client-display";
import { EmptyTableRow, PageHeader } from "@/components/admin/page-ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { LineLinkActions } from "@/components/admin/line-link-actions";
import { lineLinkStatus } from "@/components/admin/line-link-state";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/date";
import { renderClientLineWelcomeMessage } from "@/lib/line/welcome-message";
import { formatThb, parseSatang } from "@/lib/money";
import { runtimeConfig } from "@/lib/runtime-config";
import { listClients } from "@/lib/sheets/clients";
import { listSchedules } from "@/lib/sheets/schedules";
import { getLineWelcomeTemplate } from "@/lib/sheets/settings";
import { disconnectLineAction, renewLineConnectionAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const [clients, schedules, welcomeTemplate, config] = await Promise.all([listClients(), listSchedules(), getLineWelcomeTemplate(), runtimeConfig()]);
  const liffId = config.lineLiffId;
  const needle = q.toLowerCase();
  const rows = clients.filter((client) => [client.client_name, client.line_user_id, client.line_display_name].some((value) => value.toLowerCase().includes(needle)));

  return <div className="flex flex-col gap-6"><PageHeader title="Clients" description="Active plans and payment progress." actions={<Button nativeButton={false} render={<Link href="/admin/clients/new" />}>Add client</Button>} /><Card><CardHeader><div><CardTitle>Client directory <span className="font-normal text-muted-foreground">{formatClientDirectoryCount(rows.length)}</span></CardTitle></div><CardAction><form className="flex items-center gap-2"><Input className="w-56" name="q" defaultValue={q} placeholder="Search name or LINE" /><Button variant="outline" type="submit"><SearchIcon data-icon="inline-start" />Search</Button></form></CardAction></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Package</TableHead><TableHead>Payment plan</TableHead><TableHead>Total price</TableHead><TableHead>Next due</TableHead><TableHead>Payments</TableHead><TableHead>LINE</TableHead><TableHead>Active</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map((client) => { const plan = schedules.filter((item) => item.client_id === client.client_id); const paid = plan.filter((item) => item.status === "PAID").length; const next = plan.filter((item) => item.status !== "PAID").sort((left, right) => left.due_date.localeCompare(right.due_date))[0]; const message = liffId ? renderClientLineWelcomeMessage({ client, template: welcomeTemplate, businessName: config.businessDisplayName, liffId }) : ""; return <TableRow key={client.client_id}><TableCell><Link className="font-medium hover:underline" href={`/admin/clients/${client.client_id}`}>{client.client_name}</Link><p className="mt-1 text-xs text-muted-foreground">{client.line_display_name || client.line_user_id || "No LINE profile"}</p></TableCell><TableCell>{client.package_name}</TableCell><TableCell>{client.payment_type === "INSTALLMENTS" ? `${client.installment_count} installments` : "One-time"}</TableCell><TableCell>{formatThb(parseSatang(client.total_price_thb) ?? 0)}</TableCell><TableCell>{formatDate(next?.due_date)}</TableCell><TableCell>{formatPaymentProgress(paid, plan.length)}</TableCell><TableCell><LineLinkActions clientId={client.client_id} status={lineLinkStatus(client)} message={message ?? ""} expiresAt={client.line_link_token_expires_at} displayName={client.line_display_name} linkedAt={client.line_linked_at} error={client.line_link_error} compact renewAction={renewLineConnectionAction} disconnectAction={disconnectLineAction} /></TableCell><TableCell><StatusBadge status={client.active.toUpperCase() === "TRUE" ? "ACTIVE" : "INACTIVE"} /></TableCell></TableRow>; }) : <EmptyTableRow colSpan={8} icon={<UsersRoundIcon />} title="No clients found" description={q ? "Try a different search term." : "Create a client to start a payment plan."} />}</TableBody></Table></CardContent></Card></div>;
}
