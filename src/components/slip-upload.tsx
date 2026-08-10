"use client";

import { useState } from "react";

export function SlipUpload({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"idle" | "submitting" | "recorded" | "review" | "error">("idle");
  const [message, setMessage] = useState("");
  const preview = file ? URL.createObjectURL(file) : null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setState("submitting");
    const formData = new FormData();
    formData.set("slip", file);
    const response = await fetch(`/api/payment/${token}/submit`, { method: "POST", body: formData });
    const data = await response.json() as { status?: string; message?: string; error?: string };
    if (!response.ok) { setState("error"); setMessage(data.error ?? "Upload could not be processed."); return; }
    setState(data.status === "AUTO_RECORDED" ? "recorded" : "review");
    setMessage(data.message ?? "Payment slip received. It will be reviewed.");
  }

  if (state === "recorded" || state === "review") return <p className="status" role="status">{message}</p>;
  return <form className="upload" onSubmit={submit}><label htmlFor="slip">Upload payment slip</label><div className="dropzone"><span>Choose your JPEG, PNG, or WebP slip (max 10 MB).</span><input id="slip" name="slip" type="file" accept="image/jpeg,image/png,image/webp" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></div>{preview && <img className="preview" src={preview} alt="Selected payment slip preview" />}<button className="button" disabled={state === "submitting"}>{state === "submitting" ? "Processing payment slip…" : "Submit payment slip"}</button>{state === "error" && <p className="error" role="alert">{message}</p>}</form>;
}
