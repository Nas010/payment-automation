import Link from "next/link";
import { ReceiptTextIcon, SearchIcon } from "lucide-react";
import { EmptyTableRow, PageHeader } from "@/components/admin/page-ui";
import { PaymentLinkActions } from "@/components/admin/payment-link-actions";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatThb, parseSatang } from "@/lib/money";
import { isLinkedLinePaymentRecipient } from "@/lib/line/recipient";
import { listClients } from "@/lib/sheets/clients";
import { listPayments } from "@/lib/sheets/payments";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q = "", status = "" } = await searchParams;
  const activeStatus = status === "ALL" ? "" : status;
  const needle = q.toLowerCase();
  const [allPayments, clients] = await Promise.all([listPayments(), listClients()]);
  const clientsById = new Map(clients.map((client) => [client.client_id, client]));
  const payments = allPayments.filter((item) => (!activeStatus || item.status === activeStatus) && [item.client_name, item.payment_id].some((value) => value.toLowerCase().includes(needle)));

  return <div className="flex flex-col gap-6"><PageHeader title="Payments" description="Generated payment links and submitted evidence." /><Card><CardHeader><div><CardTitle>Payment ledger</CardTitle><CardDescription>{payments.length} matching payment{payments.length === 1 ? "" : "s"}.</CardDescription></div><CardAction><form className="flex flex-wrap items-center gap-2"><Input className="w-56" name="q" defaultValue={q} placeholder="Search client or payment ID" /><Select name="status" defaultValue={activeStatus || "ALL"}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="ALL">All statuses</SelectItem>{["PENDING", "AUTO_RECORDED", "REVIEW", "FLAGGED", "MANUAL_CONFIRMED"].map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectGroup></SelectContent></Select><Button type="submit" variant="outline"><SearchIcon data-icon="inline-start" />Filter</Button></form></CardAction></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Period</TableHead><TableHead>Due</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>LINE delivery</TableHead><TableHead>LINE slip</TableHead><TableHead>Payment page</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{payments.length ? payments.map((item) => {
    const client = clientsById.get(item.client_id);
    const recipient = isLinkedLinePaymentRecipient(client) ? "Recipient linked" : "Recipient missing";
    const delivery = item.line_message_status || "Not sent";
    const slip = item.line_slip_expected === "TRUE" ? item.line_slip_processing_status || "Awaiting" : "Not expected";
    return <TableRow key={item.payment_id}><TableCell><Link href={`/admin/payments/${item.payment_id}`} className="font-medium hover:underline">{item.client_name}</Link></TableCell><TableCell>{item.period}</TableCell><TableCell>{formatDate(item.due_date)}</TableCell><TableCell>{formatThb(parseSatang(item.amount_thb) ?? 0)}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell><div className="text-sm"><p>{delivery}</p><p className="text-muted-foreground">{recipient}</p><p className="text-muted-foreground">{item.line_message_attempted_at ? `Last attempt ${formatDateTime(item.line_message_attempted_at)}` : "No attempt yet"}</p></div></TableCell><TableCell>{slip}</TableCell><TableCell><PaymentLinkActions paymentUrl={item.payment_url} compact /></TableCell><TableCell>{formatDateTime(item.updated_at || item.created_at)}</TableCell></TableRow>;
  }) : <EmptyTableRow colSpan={9} icon={<ReceiptTextIcon />} title="No payments found" description="Adjust filters or generate a due payment link." />}</TableBody></Table></CardContent></Card></div>;
}
