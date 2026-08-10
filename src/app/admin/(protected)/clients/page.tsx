import Link from "next/link";
import { SearchIcon, UsersRoundIcon } from "lucide-react";
import { EmptyTableRow, PageHeader } from "@/components/admin/page-ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/date";
import { formatThb, parseSatang } from "@/lib/money";
import { listClients } from "@/lib/sheets/clients";
import { listSchedules } from "@/lib/sheets/schedules";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const [clients, schedules] = await Promise.all([listClients(), listSchedules()]);
  const needle = q.toLowerCase();
  const rows = clients.filter((client) => [client.client_name, client.line_user_id, client.line_display_name].some((value) => value.toLowerCase().includes(needle)));

  return <div className="flex flex-col gap-6"><PageHeader title="Clients" description="Active plans and payment progress." actions={<Button nativeButton={false} render={<Link href="/admin/clients/new" />}>Add client</Button>} /><Card><CardHeader><div><CardTitle>Client directory</CardTitle><CardDescription>{rows.length} matching client{rows.length === 1 ? "" : "s"}.</CardDescription></div><CardAction><form className="flex items-center gap-2"><Input className="w-56" name="q" defaultValue={q} placeholder="Search name or LINE" /><Button variant="outline" type="submit"><SearchIcon data-icon="inline-start" />Search</Button></form></CardAction></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Package</TableHead><TableHead>Payment plan</TableHead><TableHead>Total price</TableHead><TableHead>Next due</TableHead><TableHead>Progress</TableHead><TableHead>Active</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map((client) => { const plan = schedules.filter((item) => item.client_id === client.client_id); const paid = plan.filter((item) => item.status === "PAID").length; const next = plan.filter((item) => item.status !== "PAID").sort((left, right) => left.due_date.localeCompare(right.due_date))[0]; return <TableRow key={client.client_id}><TableCell><Link className="font-medium hover:underline" href={`/admin/clients/${client.client_id}`}>{client.client_name}</Link><p className="mt-1 text-xs text-muted-foreground">{client.line_display_name || client.line_user_id || "No LINE profile"}</p></TableCell><TableCell>{client.package_name}</TableCell><TableCell>{client.payment_type === "INSTALLMENTS" ? `${client.installment_count} installments` : "One-time"}</TableCell><TableCell>{formatThb(parseSatang(client.total_price_thb) ?? 0)}</TableCell><TableCell>{formatDate(next?.due_date)}</TableCell><TableCell>{paid} / {plan.length} paid</TableCell><TableCell><StatusBadge status={client.active.toUpperCase() === "TRUE" ? "ACTIVE" : "INACTIVE"} /></TableCell></TableRow>; }) : <EmptyTableRow colSpan={7} icon={<UsersRoundIcon />} title="No clients found" description={q ? "Try a different search term." : "Create a client to start a payment plan."} />}</TableBody></Table></CardContent></Card></div>;
}
