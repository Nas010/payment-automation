"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";

type Props = {
  rowNumber: number;
  active: boolean;
  action: (formData: FormData) => Promise<void>;
};

export function PackageActiveToggle({ rowNumber, active, action }: Props) {
  const [checked, setChecked] = useState(active);
  const [pending, startTransition] = useTransition();

  function onCheckedChange(next: boolean): void {
    const previous = checked;
    setChecked(next);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("package_row", String(rowNumber));
        formData.set("active", next ? "TRUE" : "FALSE");
        await action(formData);
      } catch {
        setChecked(previous);
      }
    });
  }

  return <Switch
    aria-label="Package active"
    checked={checked}
    disabled={pending}
    onCheckedChange={onCheckedChange}
  />;
}
