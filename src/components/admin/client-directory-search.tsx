"use client";

import React, { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

export function ClientDirectorySearch({ initialQuery }: { initialQuery: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);

  const updateQuery = (value: string) => {
    setQuery(value);
    router.replace(value ? `${pathname}?q=${encodeURIComponent(value)}` : pathname, { scroll: false });
  };

  return <Input className="w-56" value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Search name or LINE" aria-label="Search clients" />;
}
