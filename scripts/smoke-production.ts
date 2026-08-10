async function main(): Promise<void> {
  const baseUrl = process.env.PRODUCTION_BASE_URL?.replace(/\/$/, "");

  if (!baseUrl) throw new Error("Set PRODUCTION_BASE_URL before running the production smoke check");

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  if (!healthResponse.ok) throw new Error(`Health endpoint returned ${healthResponse.status}`);
  const health = await healthResponse.json() as { status?: string; missing?: string[] };
  if (health.status !== "ready") throw new Error(`Production is not configured: ${(health.missing ?? []).join(", ")}`);

  const token = process.env.SMOKE_PAYMENT_TOKEN;
  if (!token) {
    console.log("Health check passed. Set SMOKE_PAYMENT_TOKEN to exercise a dedicated test payment page and upload.");
    return;
  }

  const pageResponse = await fetch(`${baseUrl}/p/${encodeURIComponent(token)}`);
  if (!pageResponse.ok) throw new Error(`Payment page returned ${pageResponse.status}`);
  const page = await pageResponse.text();
  if (!page.includes("PromptPay QR")) throw new Error("Payment page did not render a PromptPay QR");

  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==", "base64");
  const form = new FormData();
  form.set("slip", new Blob([tinyPng], { type: "image/png" }), "smoke-slip.png");
  const submission = await fetch(`${baseUrl}/api/payment/${encodeURIComponent(token)}/submit`, { method: "POST", body: form });
  if (!submission.ok) throw new Error(`Slip submission returned ${submission.status}: ${await submission.text()}`);
  const result = await submission.json() as { status?: string };
  if (!result.status || !["REVIEW", "FLAGGED", "AUTO_RECORDED"].includes(result.status)) throw new Error("Slip submission did not return an operational payment status");

  console.log(`Production smoke check passed with ${result.status}. Inspect the dedicated test row and Audit Log, then delete it.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Production smoke check failed");
  process.exitCode = 1;
});
