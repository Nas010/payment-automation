import { ScrollTextIcon } from "lucide-react";
import { EmptyTableRow, PageHeader } from "@/components/admin/page-ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/date";
import { listAuditRecords } from "@/lib/sheets/audit";

export default async function AuditPage() { const audit = await listAuditRecords(); return <div className="flex flex-col gap-6"><PageHeader title="Audit log" description="Read-only payment and schedule history from the workbook." /><Card><CardHeader><CardTitle>Recent activity</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Timestamp</TableHead><TableHead>Action</TableHead><TableHead>Payment</TableHead><TableHead>Client</TableHead><TableHead>Reason</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{audit.length ? audit.map((item) => <TableRow key={item.rowNumber}><TableCell>{formatDateTime(item.timestamp)}</TableCell><TableCell className="font-medium">{item.action.replaceAll("_", " ")}</TableCell><TableCell>{item.payment_id || "—"}</TableCell><TableCell>{item.client_id}</TableCell><TableCell className="max-w-md truncate">{item.reason}</TableCell><TableCell>{item.source}</TableCell></TableRow>) : <EmptyTableRow colSpan={6} icon={<ScrollTextIcon />} title="No audit events" description="Workbook changes will be recorded here." />}</TableBody></Table></CardContent></Card></div>; }
