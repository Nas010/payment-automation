import Link from "next/link";
import { ExternalLinkIcon, ReceiptTextIcon, SearchIcon } from "lucide-react";
import { EmptyTableRow, PageHeader } from "@/components/admin/page-ui";
import { StatusBadge } from "@/components/admin/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/date";
import { formatThb, parseSatang } from "@/lib/money";
import type { PaymentRecord } from "@/lib/sheets/payments";
import { readPaymentClientSnapshot } from "@/lib/sheets/payment-client-snapshot";

export const dynamic = "force-dynamic";

function paymentContext(payment: PaymentRecord): string {
  const packageName = String(payment.package_name ?? "").trim();
  if (payment.payment_type === "ONE_TIME") return [packageName, "One-time payment"].filter(Boolean).join(" · ");
  if (payment.payment_type === "INSTALLMENTS") {
    const installmentNumber = Number(payment.installment_number);
    const installmentCount = Number(payment.installment_count);
    const installment = Number.isSafeInteger(installmentNumber) && Number.isSafeInteger(installmentCount) && installmentNumber > 0 && installmentCount > 0
      ? `Installment ${installmentNumber} of ${installmentCount}`
      : "Installment payment";
    return [packageName, installment].filter(Boolean).join(" · ");
  }
  return payment.period || "Payment";
}

function lineDeliveryState(payment: PaymentRecord): string {
  return payment.line_message_status === "ACCEPTED" ? "Sent" : "Not sent";
}

function lineSlipState(payment: PaymentRecord): string {
  if (payment.line_slip_expected !== "TRUE") return "No slip expected";
  switch (payment.line_slip_processing_status) {
    case "AUTO_RECORDED": return "Payment recorded";
    case "REVIEW": return "Needs review";
    case "FAILED_TRANSIENT": return "Retrying slip check";
    case "STOPPED": return "Slip checks stopped";
    case "DOWNLOADING":
    case "ANALYZING": return "Checking payment slip";
    default: return "Awaiting payment slip";
  }
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const { q = "", status = "" } = await searchParams;
  const activeStatus = status === "ALL" ? "" : status;
  const needle = q.toLowerCase();
  const { payments: allPayments } = await readPaymentClientSnapshot();
  const payments = allPayments.filter((item) => (!activeStatus || item.status === activeStatus) && [item.client_name, item.payment_id].some((value) => value.toLowerCase().includes(needle)));

  return <div className="flex flex-col gap-6"><PageHeader title="Payments" /><Card><CardHeader><div><CardTitle>Payment ledger</CardTitle><CardDescription>{payments.length} matching payment{payments.length === 1 ? "" : "s"}.</CardDescription></div><CardAction><form className="flex flex-wrap items-center gap-2"><Input className="w-56" name="q" defaultValue={q} placeholder="Search client or payment ID" /><Select name="status" defaultValue={activeStatus || "ALL"}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="ALL">All statuses</SelectItem>{["PENDING", "AUTO_RECORDED", "REVIEW", "FLAGGED", "MANUAL_CONFIRMED"].map((item) => <SelectItem key={item} value={item}>{item.replaceAll("_", " ")}</SelectItem>)}</SelectGroup></SelectContent></Select><Button type="submit" variant="outline"><SearchIcon data-icon="inline-start" />Filter</Button></form></CardAction></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Payment</TableHead><TableHead>Due</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>LINE delivery</TableHead><TableHead>LINE slip</TableHead><TableHead>Payment page</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{payments.length ? payments.map((item) => <TableRow key={item.payment_id}><TableCell><Link href={`/admin/payments/${item.payment_id}`} className="font-medium hover:underline">{item.client_name}</Link></TableCell><TableCell>{paymentContext(item)}</TableCell><TableCell>{formatDate(item.due_date)}</TableCell><TableCell>{formatThb(parseSatang(item.amount_thb) ?? 0)}</TableCell><TableCell><StatusBadge status={item.status} /></TableCell><TableCell>{lineDeliveryState(item)}</TableCell><TableCell>{lineSlipState(item)}</TableCell><TableCell>{item.payment_url.trim() ? <a className={buttonVariants({ size: "xs", variant: "outline" })} href={item.payment_url} target="_blank" rel="noopener noreferrer"><ExternalLinkIcon data-icon="inline-start" />Open payment</a> : <span className="text-muted-foreground">Unavailable</span>}</TableCell><TableCell>{formatDateTime(item.updated_at || item.created_at)}</TableCell></TableRow>) : <EmptyTableRow colSpan={9} icon={<ReceiptTextIcon />} title="No payments found" description="Adjust filters or generate a due payment link." />}</TableBody></Table></CardContent></Card></div>;
}
