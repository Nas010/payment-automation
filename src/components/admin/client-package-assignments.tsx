"use client";

import { useState, useTransition } from "react";
import type { PackageAssignment } from "@/lib/plans/assignment-lifecycle";
import type { BillingPackage } from "@/components/admin/client-billing-actions";
import { bangkokDateKey, formatDate } from "@/lib/date";
import { formatThb } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/admin/status-badge";
import { Textarea } from "@/components/ui/textarea";

type LifecycleAction = (formData: FormData) => void | Promise<void>;

type ClientPackageAssignmentsProps = {
  assignments: PackageAssignment[];
  packages: BillingPackage[];
  changePackageAssignmentAction: LifecycleAction;
  pausePackageAssignmentAction: LifecycleAction;
  resumePackageAssignmentAction: LifecycleAction;
  endPackageAssignmentAction: LifecycleAction;
  deletePackageAssignmentAction: LifecycleAction;
};

export function ClientPackageAssignments({
  assignments,
  packages,
  changePackageAssignmentAction,
  pausePackageAssignmentAction,
  resumePackageAssignmentAction,
  endPackageAssignmentAction,
  deletePackageAssignmentAction,
}: ClientPackageAssignmentsProps) {
  if (!assignments.length) return null;

  return <section aria-labelledby="package-assignments-title" className="flex flex-col gap-3">
    <div className="flex flex-col gap-1">
      <h2 id="package-assignments-title" className="text-lg font-semibold">Package assignments</h2>
      <p className="text-sm text-muted-foreground">Manage each package separately. Ending or deleting a package invalidates its outstanding payment links.</p>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      {assignments.map((assignment) => <PackageAssignmentCard
        key={assignment.id}
        assignment={assignment}
        packages={packages}
        changePackageAssignmentAction={changePackageAssignmentAction}
        pausePackageAssignmentAction={pausePackageAssignmentAction}
        resumePackageAssignmentAction={resumePackageAssignmentAction}
        endPackageAssignmentAction={endPackageAssignmentAction}
        deletePackageAssignmentAction={deletePackageAssignmentAction}
      />)}
    </div>
  </section>;
}

function PackageAssignmentCard({
  assignment,
  packages,
  changePackageAssignmentAction,
  pausePackageAssignmentAction,
  resumePackageAssignmentAction,
  endPackageAssignmentAction,
  deletePackageAssignmentAction,
}: Omit<ClientPackageAssignmentsProps, "assignments"> & { assignment: PackageAssignment }) {
  const mutable = assignment.state === "ACTIVE" || assignment.state === "PAUSED";
  const selectedPackage = packages.some((item) => item.package_name === assignment.label) ? assignment.label : packages[0]?.package_name ?? "";

  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-center gap-2"><CardTitle><h3>{assignment.label}</h3></CardTitle><StatusBadge status={assignment.state} /></div>
      <CardDescription>{assignment.paymentType === "ONE_TIME" ? "One-time payment" : `${assignment.installmentCount} installments`}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-5">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Metric label="Paid" value={formatThb(assignment.paidSatang)} />
        <Metric label="Remaining" value={formatThb(assignment.outstandingSatang)} />
        <Metric label="Next due" value={formatDate(assignment.nextDueDate)} />
      </dl>
      {mutable ? <>
        <ChangePackageForm assignmentId={assignment.id} assignmentLabel={assignment.label} selectedPackage={selectedPackage} packages={packages} firstDueDate={assignment.nextDueDate || bangkokDateKey()} action={changePackageAssignmentAction} />
        <div className="flex flex-wrap gap-2">
          {assignment.state === "ACTIVE" ? <LifecycleActionForm assignmentId={assignment.id} label="Pause" action={pausePackageAssignmentAction} /> : null}
          {assignment.state === "PAUSED" ? <LifecycleActionForm assignmentId={assignment.id} label="Resume" action={resumePackageAssignmentAction} /> : null}
          <LifecycleActionForm assignmentId={assignment.id} label="End" action={endPackageAssignmentAction} variant="outline" />
          {assignment.paidSatang === 0 ? <LifecycleActionForm assignmentId={assignment.id} label="Delete package" action={deletePackageAssignmentAction} variant="destructive" /> : <p className="self-center text-sm text-muted-foreground">Deletion unavailable after a recorded payment.</p>}
        </div>
      </> : assignment.paidSatang > 0 ? <p className="text-sm text-muted-foreground">Deletion unavailable after a recorded payment.</p> : null}
    </CardContent>
  </Card>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-sm text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>;
}

function ChangePackageForm({ assignmentId, assignmentLabel, selectedPackage, packages, firstDueDate, action }: { assignmentId: string; assignmentLabel: string; selectedPackage: string; packages: BillingPackage[]; firstDueDate: string; action: LifecycleAction }) {
  const [pending, startTransition] = useTransition();
  const [packageName, setPackageName] = useState(selectedPackage);
  const id = assignmentId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");

  return <form aria-label={`Change ${assignmentLabel}`} onSubmit={(event) => {
    event.preventDefault();
    const form = event.currentTarget;
    startTransition(() => { void action(new FormData(form)); });
  }}>
    <input type="hidden" name="assignment_id" value={assignmentId} />
    <FieldGroup className="grid gap-3 sm:grid-cols-2">
      <Field><FieldLabel htmlFor={`${id}-package`}>New package</FieldLabel><Select value={packageName} onValueChange={(value) => setPackageName(String(value))}><SelectTrigger id={`${id}-package`} className="w-full"><SelectValue placeholder="Choose a package" /></SelectTrigger><SelectContent><SelectGroup>{packages.map((item) => <SelectItem key={item.package_name} value={item.package_name}>{item.package_name}</SelectItem>)}</SelectGroup></SelectContent></Select><input type="hidden" name="package_name" value={packageName} /></Field>
      <Field><FieldLabel htmlFor={`${id}-first-due-date`}>First due date</FieldLabel><Input id={`${id}-first-due-date`} name="first_due_date" type="date" defaultValue={firstDueDate} required /></Field>
      <Field className="sm:col-span-2"><FieldLabel htmlFor={`${id}-notes`}>Notes</FieldLabel><Textarea id={`${id}-notes`} name="notes" placeholder="Optional notes for this package change." /></Field>
      <Button className="w-fit" type="submit" disabled={pending || !packages.length}>{pending ? "Changing…" : "Change package"}</Button>
    </FieldGroup>
  </form>;
}

function LifecycleActionForm({ assignmentId, label, action, variant = "default" }: { assignmentId: string; label: string; action: LifecycleAction; variant?: "default" | "outline" | "destructive" }) {
  const [pending, startTransition] = useTransition();
  return <form onSubmit={(event) => {
    event.preventDefault();
    const form = event.currentTarget;
    startTransition(() => { void action(new FormData(form)); });
  }}>
    <input type="hidden" name="assignment_id" value={assignmentId} />
    <Button type="submit" variant={variant} disabled={pending}>{pending ? `${label}ing…` : label}</Button>
  </form>;
}
