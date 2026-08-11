"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function AdminWorkbookError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="flex flex-col gap-5"><div><h1 className="text-2xl font-semibold">Workbook temporarily unavailable</h1><p className="text-sm text-muted-foreground">Google Sheets could not complete this request. The workbook may be rate-limited or its connection may need attention.</p></div><Alert><AlertTitle>Wait one minute, then retry once</AlertTitle><AlertDescription>Your previous change may already have been saved. Avoid repeated clicks. If this continues after one minute, check the workbook credentials and sharing in Settings.</AlertDescription></Alert><div><Button onClick={() => reset()}>Retry</Button></div></div>;
}
