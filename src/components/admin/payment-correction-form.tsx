"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = { paymentId: string; amountThb: string; status: string; revision: string; action: (data: FormData) => Promise<{ error?: string }> };

export function PaymentCorrectionForm({ paymentId, amountThb, status, revision, action }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const paid = status === "MANUAL_CONFIRMED" || status === "AUTO_RECORDED";
  return <Card>
    <CardHeader><CardTitle>Correct payment</CardTitle><CardDescription>{paid ? "Enter the full amount received, including any transfers made outside the dashboard. Saving keeps this invoice marked paid." : "Correct the invoice amount. This does not mark it paid."} Every correction is recorded with your reason.</CardDescription></CardHeader>
    <CardContent><form onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
      data.set("intent", submitter?.value || "correct");
      setMessage("");
      startTransition(async () => {
        try {
          const result = await action(data);
          setFailed(Boolean(result.error));
          setMessage(result.error || (data.get("intent") === "undo" ? "Confirmation undone. Payment is awaiting review; no message was sent." : "Payment amount corrected."));
        } catch { setFailed(true); setMessage("Could not save the correction. Refresh and check the payment before retrying."); }
      });
    }}>
      <input type="hidden" name="payment_id" value={paymentId} />
      <input type="hidden" name="revision" value={revision} />
      <FieldGroup>
        <Field><FieldLabel htmlFor="corrected_amount">{paid ? "Correct total paid (THB)" : "Correct invoice amount (THB)"}</FieldLabel><Input id="corrected_amount" name="amount_thb" type="number" min="0.01" step="0.01" defaultValue={amountThb} required /></Field>
        <Field><FieldLabel htmlFor="correction_reason">Reason for correction</FieldLabel><Textarea id="correction_reason" name="reason" required placeholder="For example: ฿4,900 paid originally plus ฿900 received separately; total ฿5,800." /></Field>
        <Field orientation="horizontal"><input id="correction_acknowledged" name="acknowledged" type="checkbox" required /><FieldLabel htmlFor="correction_acknowledged">I checked the amount and payment status against my records.</FieldLabel></Field>
        <div className="flex flex-wrap gap-2"><Button type="submit" value="correct" disabled={pending}>Save corrected amount</Button>{status === "MANUAL_CONFIRMED" ? <Button type="submit" value="undo" variant="outline" disabled={pending}>Undo manual confirmation</Button> : null}</div>
        {status === "MANUAL_CONFIRMED" ? <p className="text-sm text-muted-foreground">Undo returns this payment to review using the amount above. It does not refund money or send another payment request.</p> : null}
        {message ? <p role={failed ? "alert" : "status"} className="text-sm">{message}</p> : null}
      </FieldGroup>
    </form></CardContent>
  </Card>;
}
