import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { loginAction } from "./actions";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="grid min-h-svh place-items-center bg-muted/30 p-4"><Card className="w-full max-w-sm"><CardHeader><CardTitle>Admin sign in</CardTitle><CardDescription>Enter the server-configured admin secret to manage payments.</CardDescription></CardHeader><CardContent><form action={loginAction}><FieldGroup>{error ? <Alert variant="destructive"><AlertTitle>Sign-in failed</AlertTitle><AlertDescription>Secret did not match. Try again.</AlertDescription></Alert> : null}<Field><FieldLabel htmlFor="admin_secret">Admin secret</FieldLabel><Input id="admin_secret" name="admin_secret" type="password" required autoComplete="current-password" /></Field><Button type="submit" size="lg">Sign in</Button></FieldGroup></form></CardContent></Card></main>;
}
