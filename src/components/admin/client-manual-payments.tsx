"use client";

import { useState, useTransition } from "react";
import type { PackageAssignment } from "@/lib/plans/assignment-lifecycle";
import { formatDate } from "@/lib/date";
import { formatThb } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/admin/status-badge";

type Action = (formData: FormData) => void | Promise<void>;

export function ClientManualPayments({ assignments, cancelAction, removeAction }: { assignments: PackageAssignment[]; cancelAction: Action; removeAction: Action }) {
  const visible = assignments.filter((assignment) => assignment.state !== "DELETED");
  if (!visible.length) return null;
  return <section aria-labelledby="manual-payments-title" className="flex flex-col gap-3">
    <h2 id="manual-payments-title" className="text-lg font-semibold">Manual payments</h2>
    <p className="text-sm text-muted-foreground">Cancel stops remaining payments and invalidates their links. Remove hides an unpaid plan entered by mistake. Activity history is retained.</p>
    <div className="grid gap-4 xl:grid-cols-2">{visible.map((assignment) => <ManualPaymentCard key={assignment.id} assignment={assignment} cancelAction={cancelAction} removeAction={removeAction} />)}</div>
  </section>;
}

function ManualPaymentCard({ assignment, cancelAction, removeAction }: { assignment: PackageAssignment; cancelAction: Action; removeAction: Action }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const active = assignment.state === "ACTIVE" || assignment.state === "PAUSED";
  function submit(action: Action) {
    setError("");
    const data = new FormData();
    data.set("assignment_id", assignment.id);
    startTransition(async () => {
      try { await action(data); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update manual payments. Please retry."); }
    });
  }
  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-center gap-2"><CardTitle><h3>{assignment.label}</h3></CardTitle><StatusBadge status={assignment.state === "ENDED" ? "CANCELLED" : assignment.state} /></div>
      <CardDescription>{assignment.paymentType === "ONE_TIME" ? "One-time payment" : `${assignment.installmentCount} payments`} · Remaining {formatThb(assignment.outstandingSatang)}{assignment.nextDueDate ? ` · Next due ${formatDate(assignment.nextDueDate)}` : ""}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {active ? <Button variant="outline" disabled={pending} onClick={() => submit(cancelAction)}>Cancel payments</Button> : null}
        {assignment.paidSatang === 0 ? <Button variant="destructive" disabled={pending} onClick={() => submit(removeAction)}>Remove</Button> : <p className="text-sm text-muted-foreground">Recorded payments are retained. Only remaining payments can be cancelled.</p>}
      </div>
      {pending ? <p role="status" className="text-sm">Updating…</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </CardContent>
  </Card>;
}
