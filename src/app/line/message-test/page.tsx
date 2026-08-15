import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LINE message test",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function MessageTestPage() {
  return <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
    <section className="w-full max-w-lg rounded-2xl border bg-background p-8 text-center shadow-sm">
      <div className="mb-4 text-5xl" aria-hidden="true">🧪</div>
      <h1 className="text-2xl font-semibold">Test message only</h1>
      <p className="mt-3 text-muted-foreground">
        No payment is due. This page was opened from a LINE delivery test.
      </p>
    </section>
  </main>;
}
