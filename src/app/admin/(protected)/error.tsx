"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function AdminWorkbookError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="flex flex-col gap-5"><div><h1 className="text-2xl font-semibold">Workbook unavailable</h1><p className="text-sm text-muted-foreground">Admin UI is connected. Google Sheets configuration still needs attention.</p></div><Alert><AlertTitle>Connect workbook to continue</AlertTitle><AlertDescription>Set server-side Sheets credentials and payment receiver settings, then restart local server or redeploy. No workbook data has been changed.</AlertDescription></Alert><div><Button onClick={() => reset()}>Retry connection</Button></div></div>;
}
