"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type GoogleDriveStatus = {
  connected: boolean;
  accountEmail?: string;
  folderName?: string;
  validatedAt?: string;
};

type PickerDocument = { id?: string; name?: string; mimeType?: string };
type PickerCallbackData = { action?: string; docs?: PickerDocument[]; [key: string]: unknown };
type PickerBuilder = {
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  addView: (view: unknown) => PickerBuilder;
  setCallback: (callback: (data: PickerCallbackData) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};
type PickerApi = {
  gapi?: { load: (name: string, callback: () => void) => void };
  google?: {
    picker: {
      PickerBuilder: new () => PickerBuilder;
      DocsView: new (viewId: string) => { setIncludeFolders: (include: boolean) => unknown; setSelectFolderEnabled: (enabled: boolean) => unknown };
      ViewId: { FOLDERS: string };
      Action: { PICKED: string; CANCEL: string };
    };
  };
};

export type GoogleDriveConnectionAction = (formData: FormData) => Promise<{
  ok: boolean;
  status: "CONNECTED" | "FAILED";
  message: string;
  accountEmail?: string;
  folderName?: string;
  validatedAt?: string;
}>;

const safePickerErrors = new Set([
  "Google Drive connection is not configured.",
  "Google Drive connection is not connected.",
  "Google Drive connection needs attention.",
  "Could not connect Google Drive. Try again.",
]);

let pickerScriptPromise: Promise<void> | null = null;

function pickerApi(): PickerApi {
  return globalThis as unknown as PickerApi;
}

function loadPickerScript(): Promise<void> {
  const api = pickerApi();
  if (api.gapi?.load) return new Promise((resolve) => api.gapi?.load("picker", resolve));
  if (pickerScriptPromise) return pickerScriptPromise;
  pickerScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = () => {
      const loaded = pickerApi();
      if (loaded.gapi?.load) loaded.gapi.load("picker", resolve);
      else reject(new Error("picker_unavailable"));
    };
    script.onerror = () => reject(new Error("picker_unavailable"));
    document.head.appendChild(script);
  });
  return pickerScriptPromise;
}

function safePickerMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return safePickerErrors.has(message) ? message : "Could not connect Google Drive. Try again.";
}

export function GoogleDriveConnectionCard({
  status,
  canConnect,
  autoOpenPicker,
  initialError,
  activateAction,
  authorizationReady = false,
}: {
  status: GoogleDriveStatus;
  canConnect: boolean;
  autoOpenPicker: boolean;
  initialError: string;
  activateAction: GoogleDriveConnectionAction;
  authorizationReady?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState(initialError);
  const [pickerError, setPickerError] = useState("");
  const openedAutomatically = useRef(false);

  const openPicker = useCallback(async () => {
    if (!canConnect || pending) return;
    setPickerError("");
    try {
      const response = await fetch("/admin/google-drive/picker-token", { cache: "no-store" });
      const body = await response.json() as { accessToken?: string; appId?: string; apiKey?: string; error?: string };
      if (!response.ok) throw new Error(safePickerErrors.has(body.error ?? "") ? body.error : "Could not connect Google Drive. Try again.");
      if (!body.accessToken || !body.appId || !body.apiKey) throw new Error("Could not connect Google Drive. Try again.");
      await loadPickerScript();
      const api = pickerApi();
      const docsView = new api.google!.picker.DocsView(api.google!.picker.ViewId.FOLDERS);
      docsView.setIncludeFolders(true);
      docsView.setSelectFolderEnabled(true);
      const picker = new api.google!.picker.PickerBuilder()
        .setOAuthToken(body.accessToken)
        .setDeveloperKey(body.apiKey)
        .setAppId(body.appId)
        .addView(docsView)
        .setCallback((data) => {
          if (data.action !== api.google!.picker.Action.PICKED) return;
          const document = data.docs?.[0];
          if (!document?.id || !document.name) {
            setPickerError("Could not connect Google Drive. Try again.");
            return;
          }
          const formData = new FormData();
          formData.set("folder_id", document.id);
          formData.set("folder_name", document.name);
          startTransition(async () => {
            try {
              const result = await activateAction(formData);
              setOutcome(result.message);
              if (result.ok) router.refresh();
              else setPickerError(result.message);
            } catch {
              setPickerError("Could not connect Google Drive. Try again.");
            }
          });
        })
        .build();
      picker.setVisible(true);
    } catch (error) {
      setPickerError(safePickerMessage(error));
    }
  }, [activateAction, canConnect, pending, router]);

  useEffect(() => {
    if (!autoOpenPicker || openedAutomatically.current || !canConnect) return;
    openedAutomatically.current = true;
    void openPicker();
  }, [autoOpenPicker, canConnect, openPicker]);

  const error = pickerError || outcome;
  return <Card>
    <CardHeader>
      <CardTitle>Google Drive slip storage</CardTitle>
      <CardDescription>Connect the Google account that should own private payment-slip files, then choose one folder.</CardDescription>
    </CardHeader>
    <CardContent>
      {status.connected ? <div className="space-y-3 text-sm">
        <p><span className="font-medium">Connected account:</span> {status.accountEmail}</p>
        <p><span className="font-medium">Folder:</span> {status.folderName}</p>
        <p className="text-muted-foreground">Last validated: {status.validatedAt}</p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={() => void openPicker()} disabled={!canConnect || pending}>{pending ? "Working…" : "Change folder"}</Button>
          <DriveLink href="/admin/google-drive/connect?intent=reconnect" variant="outline">Reconnect account</DriveLink>
        </div>
      </div> : <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Google Drive is not connected. Connect an account to select your private slip folder.</p>
        {canConnect && authorizationReady ? <Button type="button" onClick={() => void openPicker()} disabled={pending}>{pending ? "Working…" : "Select folder"}</Button> : canConnect ? <DriveLink href="/admin/google-drive/connect?intent=setup">Connect Google Drive</DriveLink> : <p className="text-sm text-destructive">Google Drive connection is not configured.</p>}
      </div>}
      {error ? <p className={error.includes("connected") || error.includes("configured") ? "mt-4 text-sm text-muted-foreground" : "mt-4 text-sm text-destructive"}>{error}</p> : null}
    </CardContent>
  </Card>;
}

function DriveLink({ href, variant = "default", children }: { href: string; variant?: "default" | "outline"; children: ReactNode }) {
  return <a href={href} className={cn(buttonVariants({ variant }))}>{children}</a>;
}
