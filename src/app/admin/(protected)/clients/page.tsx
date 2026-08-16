import Link from "next/link";
import { SearchIcon, UsersRoundIcon } from "lucide-react";
import { formatClientDirectoryCount } from "@/lib/admin/client-display";
import { EmptyTableRow, PageHeader } from "@/components/admin/page-ui";
import { ClientAvatar } from "@/components/admin/client-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/date";
import { formatThb, parseSatang } from "@/lib/money";
import { listClients } from "@/lib/sheets/clients";
import { listSchedules } from "@/lib/sheets/schedules";

export const dynamic = "force-dynamic";

function PaymentProgress({ paid, total }: { paid: number; total: number }) {
  if (!total) return <span className="text-muted-foreground">—</span>;
  const percentage = Math.round((paid / total) * 100);
  return <div className="flex items-center gap-2"><div role="progressbar" aria-label={`${paid} of ${total} payments paid`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={paid} className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} /></div><span className="text-sm tabular-nums">{paid} / {total}</span></div>;
}

function ClientActivity({ active }: { active: boolean }) {
  const label = active ? "Active" : "Inactive";
  return <span className="inline-flex items-center gap-2 text-sm" aria-label={`Client ${label.toLowerCase()}`}><span aria-hidden="true" className={`size-2 rounded-full ${active ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />{label}</span>;
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const [clients, schedules] = await Promise.all([listClients(), listSchedules()]);
  const needle = q.toLowerCase();
  const rows = clients.filter((client) => [client.client_name, client.line_user_id, client.line_display_name].some((value) => value.toLowerCase().includes(needle)));

  return <div className="flex flex-col gap-6"><PageHeader title="Clients" actions={<Button nativeButton={false} render={<Link href="/admin/clients/new" />}>Add client</Button>} /><Card><CardHeader><div><CardTitle>Client directory <span className="font-normal text-muted-foreground">{formatClientDirectoryCount(rows.length)}</span></CardTitle></div><CardAction><form className="flex items-center gap-2"><Input className="w-56" name="q" defaultValue={q} placeholder="Search name or LINE" /><Button variant="outline" type="submit"><SearchIcon data-icon="inline-start" />Search</Button></form></CardAction></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Package</TableHead><TableHead>Payment plan</TableHead><TableHead>Total price</TableHead><TableHead>Next due</TableHead><TableHead>Payments</TableHead><TableHead>Active</TableHead></TableRow></TableHeader><TableBody>{rows.length ? rows.map((client) => { const plan = schedules.filter((item) => item.client_id === client.client_id); const paid = plan.filter((item) => item.status === "PAID").length; const next = plan.filter((item) => item.status !== "PAID").sort((left, right) => left.due_date.localeCompare(right.due_date))[0]; return <TableRow key={client.client_id}><TableCell><div className="flex items-center gap-3"><ClientAvatar clientName={client.client_name} lineDisplayName={client.line_display_name} pictureUrl={client.line_picture_url} /><div><Link className="font-medium hover:underline" href={`/admin/clients/${client.client_id}`}>{client.client_name}</Link><p className="mt-1 text-xs text-muted-foreground">{client.line_display_name || client.line_user_id || "No LINE profile"}</p></div></div></TableCell><TableCell>{client.package_name}</TableCell><TableCell>{client.payment_type === "INSTALLMENTS" ? "Installments" : "One-time payment"}</TableCell><TableCell>{formatThb(parseSatang(client.total_price_thb) ?? 0)}</TableCell><TableCell>{formatDate(next?.due_date)}</TableCell><TableCell><PaymentProgress paid={paid} total={plan.length} /></TableCell><TableCell><ClientActivity active={client.active.toUpperCase() === "TRUE"} /></TableCell></TableRow>; }) : <EmptyTableRow colSpan={7} icon={<UsersRoundIcon />} title="No clients found" description={q ? "Try a different search term." : "Create a client to start a payment plan."} />}</TableBody></Table></CardContent></Card></div>;
}
