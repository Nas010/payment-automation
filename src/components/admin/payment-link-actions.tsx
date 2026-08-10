"use client";

import React, { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

type PaymentLinkActionsProps = {
  paymentUrl: string;
  compact?: boolean;
};

type CopyState = "idle" | "copied" | "failed";

export function PaymentLinkActions({ paymentUrl, compact = false }: PaymentLinkActionsProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const url = paymentUrl.trim();

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  if (!url) return <span className="text-sm text-muted-foreground">Link unavailable</span>;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };
  const copyLabel = copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy link";
  const size = compact ? "xs" : "default";

  return <div className="flex flex-wrap items-center gap-2">
    <a className={buttonVariants({ variant: "outline", size })} href={url} target="_blank" rel="noopener noreferrer">
      <ExternalLinkIcon data-icon="inline-start" />Open payment page
    </a>
    <Button type="button" variant="outline" size={size} onClick={copyLink}>
      {copyState === "copied" ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}{copyLabel}
    </Button>
    <span className="sr-only" aria-live="polite">{copyState === "idle" ? "" : copyLabel}</span>
  </div>;
}
