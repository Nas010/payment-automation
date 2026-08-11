import type { ReactNode } from "react";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { TableCell, TableRow } from "@/components/ui/table";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div className="flex max-w-2xl flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>;
}

export function MetricCard({ label, value, description, trend }: { label: string; value: string; description?: string; trend?: ReactNode }) {
  return <Card size="sm">
    <CardHeader>
      <CardDescription>{label}</CardDescription>
      <CardTitle className="text-2xl tracking-tight">{value}</CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
      {trend ? <CardAction>{trend}</CardAction> : null}
    </CardHeader>
  </Card>;
}

export function EmptyTableRow({ colSpan, icon, title, description }: { colSpan: number; icon: ReactNode; title: string; description: string }) {
  return <TableRow>
    <TableCell colSpan={colSpan} className="p-0">
      <Empty className="border-0 py-12">
        <EmptyHeader>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </TableCell>
  </TableRow>;
}
