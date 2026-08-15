"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

function avatarInitials(lineDisplayName: string, clientName: string): string {
  const words = (lineDisplayName.trim() || clientName.trim())
    .split(/\s+/u)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2);
  return words.map((word) => Array.from(word)[0]).join("").toUpperCase() || "?";
}

export function ClientAvatar({ clientName, lineDisplayName, pictureUrl, size = "sm" }: { clientName: string; lineDisplayName: string; pictureUrl: string; size?: "sm" | "lg" }) {
  const [failedUrl, setFailedUrl] = useState("");
  const pixels = size === "lg" ? 48 : 32;
  const showPicture = Boolean(pictureUrl) && failedUrl !== pictureUrl;

  return <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-semibold text-muted-foreground ring-1 ring-foreground/10", size === "lg" ? "size-12 text-sm" : "size-8 text-xs")}>
    {showPicture ? <Image src={pictureUrl} alt={`LINE profile picture for ${clientName}`} width={pixels} height={pixels} className="size-full object-cover" onError={() => setFailedUrl(pictureUrl)} /> : <span aria-label={`${clientName} avatar`}>{avatarInitials(lineDisplayName, clientName)}</span>}
  </span>;
}
