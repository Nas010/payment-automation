import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="grid min-h-svh place-items-center bg-muted/30 p-4"><Card className="w-full max-w-sm"><CardHeader><CardTitle>Admin sign in</CardTitle><CardDescription>Use the Google account that will own this payment workspace.</CardDescription></CardHeader><CardContent className="space-y-4">{error ? <Alert variant="destructive"><AlertTitle>Sign-in failed</AlertTitle><AlertDescription>{loginErrorMessage(error)}</AlertDescription></Alert> : null}<Link className={buttonVariants({ size: "lg", className: "w-full" })} href="/admin/google-drive/connect?intent=login">Continue with Google</Link><p className="text-xs text-muted-foreground">The first verified Google account becomes the permanent owner.</p></CardContent></Card></main>;
}

function loginErrorMessage(error: string): string {
  switch (error) {
    case "access_denied": return "This installation already belongs to another Google account.";
    case "oauth_denied": return "Google sign-in was canceled.";
    case "oauth_not_configured": return "Google sign-in is not configured yet.";
    case "oauth_missing_refresh_token": return "Google did not grant offline access. Try again and approve access.";
    default: return "Google sign-in could not be completed. Try again.";
  }
}
