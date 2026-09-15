"use client";

import { useState, useTransition } from "react";
import type { PackageAssignment } from "@/lib/plans/assignment-lifecycle";
import { Button } from "@/components/ui/button";

type Action = (formData: FormData) => void | Promise<void>;

export function ClientManualPayments({ assignments, cancelAction, removeAction }: { assignments: PackageAssignment[]; cancelAction: Action; removeAction: Action }) {
  const visible = assignments.filter((assignment) => assignment.state !== "DELETED");
  if (!visible.length) return null;
  return <>{visible.map((assignment) => <ManualPaymentActions key={assignment.id} assignment={assignment} cancelAction={cancelAction} removeAction={removeAction} />)}</>;
}

function ManualPaymentActions({ assignment, cancelAction, removeAction }: { assignment: PackageAssignment; cancelAction: Action; removeAction: Action }) {
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
  return <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {active ? <Button size="sm" variant="outline" disabled={pending} onClick={() => submit(cancelAction)}>Cancel payments</Button> : null}
        {assignment.paidSatang === 0 ? <Button size="sm" variant="destructive" disabled={pending} onClick={() => submit(removeAction)}>Remove</Button> : <p className="text-sm text-muted-foreground">Recorded payments are retained. Only remaining payments can be cancelled.</p>}
      </div>
      {pending ? <p role="status" className="text-sm">Updating…</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {Number(assignment.installmentCount) > 1 ? <p className="text-xs text-muted-foreground">Applies to the whole recurring plan.</p> : null}
  </div>;
}
