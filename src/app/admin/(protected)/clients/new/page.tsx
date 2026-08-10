import { ClientForm } from "@/components/admin/client-form";
import { listPackages } from "@/lib/sheets/settings";
import { createClientAction } from "../../actions";

export default async function NewClientPage() { const packages = (await listPackages()).filter((item) => item.active.toUpperCase() === "TRUE"); return <div className="flex flex-col gap-6"><div><h1 className="text-2xl font-semibold">Create client</h1><p className="text-sm text-muted-foreground">Choose a package, set first due date, and review plan defaults.</p></div><ClientForm packages={packages} action={createClientAction} /></div>; }
