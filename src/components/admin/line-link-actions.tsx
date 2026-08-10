"use client";

import React, { useEffect, useState, useTransition } from "react";
import { CheckIcon, CopyIcon, LinkIcon, RefreshCwIcon, UnlinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export type LineLinkStatus = "LINKED" | "CODE_ACTIVE" | "UNLINKED" | "EXPIRED" | "REVIEW";

type RenewResult = { clientId: string; code: string; status: "CODE_ACTIVE" } | null;
type Props = {
  clientId: string;
  status: LineLinkStatus;
  instruction?: string;
  code?: string;
  expiresAt?: string;
  displayName?: string;
  linkedAt?: string;
  error?: string;
  compact?: boolean;
  renewAction: (clientId: string) => Promise<RenewResult>;
  disconnectAction: (clientId: string) => Promise<boolean>;
};

function reviewMessage(error?: string): string {
  return error === "LINE user conflict" ? error : "LINE connection needs review.";
}

export function LineLinkActions({ clientId, status, instruction = "", code = "", expiresAt = "", displayName = "", linkedAt = "", error, compact = false, renewAction, disconnectAction }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [outcome, setOutcome] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const copyInstruction = async () => {
    try {
      await navigator.clipboard.writeText(instruction);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  const renew = () => startTransition(async () => {
    try {
      const result = await renewAction(clientId);
      setOutcome(result ? "New LINE code generated." : "Could not generate a LINE code.");
    } catch {
      setOutcome("Could not update LINE linking. Try again.");
    }
  });
  const disconnect = () => startTransition(async () => {
    try {
      const disconnected = await disconnectAction(clientId);
      setOutcome(disconnected ? "LINE account disconnected." : "Could not disconnect LINE account.");
    } catch {
      setOutcome("Could not update LINE linking. Try again.");
    }
  });
  const size = compact ? "xs" : "sm";

  if (status === "LINKED") return <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">Linked to {displayName || "LINE account"}</span>{linkedAt ? <span className="text-muted-foreground">{linkedAt}</span> : null}<Button type="button" size={size} variant="outline" disabled={pending} onClick={disconnect}><UnlinkIcon data-icon="inline-start" />Disconnect LINE</Button><Outcome value={outcome} /></div>;

  if (status === "CODE_ACTIVE") return <div className="flex flex-col gap-2 text-sm"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">Code active{code ? `: ${code}` : ""}</span>{expiresAt ? <span className="text-muted-foreground">Expires {expiresAt}</span> : null}</div>{!compact && instruction ? <p className="whitespace-pre-line rounded-md border bg-muted/40 p-3 text-xs">{instruction}</p> : null}<div className="flex flex-wrap items-center gap-2"><Button type="button" size={size} variant="outline" disabled={pending || !instruction} onClick={copyInstruction}>{copyState === "copied" ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}{copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy instructions"}</Button><Button type="button" size={size} variant="outline" disabled={pending} onClick={renew}><RefreshCwIcon data-icon="inline-start" />Renew code</Button><Outcome value={outcome} /></div></div>;

  if (status === "REVIEW") return <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-destructive">{reviewMessage(error)}</span><Button type="button" size={size} variant="outline" disabled={pending} onClick={renew}><RefreshCwIcon data-icon="inline-start" />Renew code</Button><Button type="button" size={size} variant="outline" disabled={pending} onClick={disconnect}><UnlinkIcon data-icon="inline-start" />Disconnect LINE</Button><Outcome value={outcome} /></div>;

  const expired = status === "EXPIRED";
  return <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted-foreground">{expired ? "Link code expired." : "LINE not linked."}</span><Button type="button" size={size} variant="outline" disabled={pending} onClick={renew}><LinkIcon data-icon="inline-start" />{expired ? "Generate new code" : "Generate code"}</Button><Outcome value={outcome} /></div>;
}

function Outcome({ value }: { value: string }) {
  return <span className="sr-only" aria-live="polite">{value}</span>;
}
