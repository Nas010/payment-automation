"use client";

import liff from "@line/liff";
import { useEffect, useState } from "react";
import { CheckCircle2Icon, CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ConnectionState = "connecting" | "success" | "already_used" | "expired" | "conflict" | "invalid" | "temporary_failure";

const copy: Record<ConnectionState, { title: string; description: string }> = {
  connecting: { title: "Connecting your LINE account…", description: "Keep this window open for a moment." },
  success: { title: "LINE account connected", description: "Returning you to LINE." },
  already_used: { title: "LINE account already connected", description: "This account was already linked. You can return to LINE." },
  expired: { title: "Connection link expired", description: "Ask your coach to create a new connection link." },
  conflict: { title: "Connection needs review", description: "Ask your coach to check the existing LINE connection." },
  invalid: { title: "Connection link is invalid", description: "Ask your coach for a new welcome message." },
  temporary_failure: { title: "Could not connect right now", description: "Try this link again in a few minutes." },
};

function responseState(value: unknown): ConnectionState {
  if (!value || typeof value !== "object") return "temporary_failure";
  const status = (value as { status?: unknown }).status;
  return status === "success" || status === "already_used" || status === "expired" || status === "conflict" || status === "invalid" || status === "temporary_failure"
    ? status
    : "temporary_failure";
}

export function LineConnectClient({ liffId, connectionToken }: { liffId: string; connectionToken: string }) {
  const [state, setState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    let active = true;
    let closeTimer: number | undefined;
    const connect = async () => {
      if (!liffId) {
        setState("temporary_failure");
        return;
      }
      try {
        await liff.init({ liffId });
        const restoredToken = new URLSearchParams(window.location.search).get("token") ?? connectionToken;
        if (!/^[A-Za-z0-9_-]{43}$/.test(restoredToken)) {
          if (active) setState("invalid");
          return;
        }
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }
        const idToken = liff.getIDToken();
        if (!idToken) {
          if (active) setState("invalid");
          return;
        }
        const response = await fetch("/api/line/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, connectionToken: restoredToken }),
        });
        const result = responseState(await response.json().catch(() => null));
        if (!active) return;
        setState(result);
        if (result === "success" || result === "already_used") closeTimer = window.setTimeout(() => liff.closeWindow(), 800);
      } catch {
        if (active) setState("temporary_failure");
      }
    };
    void connect();
    return () => {
      active = false;
      if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    };
  }, [connectionToken, liffId]);

  const content = copy[state];
  const pending = state === "connecting";
  const successful = state === "success" || state === "already_used";
  return <Card className="w-full max-w-md">
    <CardHeader className="text-center">
      <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
        {pending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : successful ? <CheckCircle2Icon className="text-emerald-600" aria-hidden="true" /> : <CircleAlertIcon className="text-amber-600" aria-hidden="true" />}
      </div>
      <CardTitle>{content.title}</CardTitle>
      <CardDescription>{content.description}</CardDescription>
    </CardHeader>
    {!pending ? <CardContent className="flex justify-center">
      <Button nativeButton={false} render={<a href="https://line.me/R/" onClick={(event) => {
        if (liff.isInClient()) {
          event.preventDefault();
          liff.closeWindow();
        }
      }} />}>Return to LINE</Button>
    </CardContent> : null}
  </Card>;
}
