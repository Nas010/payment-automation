"use client";

import React, { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export type LinePaymentActionResult = { outcome: "SENT" | "ALREADY_ACCEPTED" | "DISABLED" | "MISSING_RECIPIENT" | "FAILED" | "NOT_ELIGIBLE" };

type Props = {
  paymentId: string;
  messageStatus: string;
  slipExpected: boolean;
  slipProcessingStatus: string;
  sendAction: (paymentId: string) => Promise<LinePaymentActionResult>;
  stopAwaitingAction: (paymentId: string) => Promise<boolean>;
};

const outcomeMessage: Record<LinePaymentActionResult["outcome"], string> = {
  SENT: "LINE payment request sent.",
  ALREADY_ACCEPTED: "LINE already accepted this payment request.",
  DISABLED: "LINE messaging is disabled.",
  MISSING_RECIPIENT: "Client has no active linked LINE account.",
  FAILED: "LINE payment request failed. Review status before retrying.",
  NOT_ELIGIBLE: "This payment is not eligible for a LINE request.",
};

export function LinePaymentActions({ paymentId, messageStatus, slipExpected, slipProcessingStatus, sendAction, stopAwaitingAction }: Props) {
  const [outcome, setOutcome] = useState("");
  const [pending, startTransition] = useTransition();
  const accepted = messageStatus === "ACCEPTED";

  const send = () => startTransition(async () => {
    try {
      setOutcome(outcomeMessage[(await sendAction(paymentId)).outcome]);
    } catch {
      setOutcome("Could not send LINE payment request.");
    }
  });

  const stopAwaiting = () => startTransition(async () => {
    try {
      setOutcome(await stopAwaitingAction(paymentId) ? "Stopped awaiting a LINE slip." : "LINE slip state changed before this update.");
    } catch {
      setOutcome("Could not stop LINE slip intake.");
    }
  });

  return <div className="flex flex-wrap items-center gap-2">
    {accepted ? <span className="text-sm text-muted-foreground">LINE accepted this payment request.</span> : <Button type="button" variant="outline" size="sm" disabled={pending} onClick={send}>Send LINE payment request</Button>}
    {slipExpected && slipProcessingStatus === "AWAITING" ? <Button type="button" variant="outline" size="sm" disabled={pending} onClick={stopAwaiting}>Stop awaiting LINE slip</Button> : null}
    {outcome ? <span className="text-sm" aria-live="polite">{outcome}</span> : null}
  </div>;
}
