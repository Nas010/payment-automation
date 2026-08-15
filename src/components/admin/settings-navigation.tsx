"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Building2Icon, DatabaseIcon, ImageIcon, MenuIcon, MessageCircleIcon, ScrollTextIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const settingsSections = [
  { href: "/admin/settings/business", label: "Business & payments", icon: Building2Icon },
  { href: "/admin/settings/workspace", label: "Workspace", icon: DatabaseIcon },
  { href: "/admin/settings/line", label: "LINE channel", icon: MessageCircleIcon },
  { href: "/admin/settings/messages", label: "Messages", icon: ScrollTextIcon },
  { href: "/admin/settings/payment-delivery", label: "Payment delivery", icon: ImageIcon },
] as const;

export function SettingsNavigation() {
  const pathname = usePathname();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  return <>
    <aside className="sticky top-6 hidden w-52 shrink-0 lg:block" aria-label="Settings navigation">
      <SidebarGroup className="rounded-lg border bg-card p-3">
        <SidebarGroupLabel className="px-2 text-foreground">Settings</SidebarGroupLabel>
        <SidebarGroupContent>
          <SettingsSectionList pathname={pathname} />
        </SidebarGroupContent>
      </SidebarGroup>
    </aside>
    <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
      <SheetTrigger render={<Button variant="outline" className="w-fit lg:hidden" aria-label="Open settings navigation" />}>
        <MenuIcon data-icon="inline-start" />
        Settings sections
      </SheetTrigger>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle>Settings navigation</SheetTitle>
          <SheetDescription>Choose a settings section.</SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-4 pb-4" aria-label="Settings navigation">
          {settingsSections.map((section) => {
            const active = pathname === section.href;
            return <Link key={section.href} href={section.href} aria-current={active ? "page" : undefined} onClick={() => setMobileNavigationOpen(false)} className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground", active && "bg-accent font-medium text-accent-foreground")}>
              <section.icon />
              <span>{section.label}</span>
            </Link>;
          })}
        </nav>
      </SheetContent>
    </Sheet>
  </>;
}

function SettingsSectionList({ pathname }: { pathname: string }) {
  return <SidebarMenu>
    {settingsSections.map((section) => {
      const active = pathname === section.href;
      return <SidebarMenuItem key={section.href}>
        <SidebarMenuButton isActive={active} render={<Link href={section.href} aria-current={active ? "page" : undefined} />}>
          <section.icon />
          <span>{section.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>;
    })}
  </SidebarMenu>;
}
