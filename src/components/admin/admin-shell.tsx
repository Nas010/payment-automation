"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleAlertIcon, DatabaseIcon, LayoutDashboardIcon, LogOutIcon, PackageIcon, ReceiptTextIcon, ScrollTextIcon, SettingsIcon, UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { logoutAction } from "@/app/admin/login/actions";

const navigation = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/admin/clients", label: "Clients", icon: UsersIcon },
  { href: "/admin/payments", label: "Payments", icon: ReceiptTextIcon },
  { href: "/admin/review", label: "Review Queue", icon: CircleAlertIcon },
  { href: "/admin/packages", label: "Packages", icon: PackageIcon },
  { href: "/admin/settings", label: "Settings", icon: SettingsIcon },
  { href: "/admin/audit", label: "Audit Log", icon: ScrollTextIcon },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <SidebarProvider>
    <Sidebar collapsible="icon" variant="inset">
      <AdminSidebarHeader />
      <Separator />
      <SidebarContent>
        <AdminNavigation pathname={pathname} />
      </SidebarContent>
      <SidebarFooter className="gap-3 p-3 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2"><Separator /><form action={logoutAction}><Button variant="ghost" size="sm" title="Sign out" className="w-full justify-start gap-2 group-data-[collapsible=icon]:size-7 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"><LogOutIcon /><span className="group-data-[collapsible=icon]:sr-only">Sign out</span></Button></form></SidebarFooter>
    </Sidebar>
    <SidebarInset className="bg-muted/30"><main className="mx-auto w-full max-w-[1440px] p-4 md:p-6">{children}</main></SidebarInset>
  </SidebarProvider>;
}

function AdminSidebarHeader() {
  const { state } = useSidebar();
  return <SidebarHeader className="px-2 py-3 group-data-[collapsible=icon]:px-0"><div className="flex items-center justify-between gap-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0">
    {state === "collapsed" ? <SidebarTrigger className="size-7" aria-label="Toggle Sidebar"><span className="grid size-7 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"><DatabaseIcon /></span><span className="sr-only">Toggle Sidebar</span></SidebarTrigger> : <>
      <Link href="/admin/dashboard" className="flex min-w-0 items-center gap-1.5 px-1 text-sm font-semibold tracking-tight"><span className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"><DatabaseIcon /></span><span className="truncate whitespace-nowrap">Coaching Payments</span></Link>
      <SidebarTrigger className="size-7" />
    </>}
  </div></SidebarHeader>;
}

function AdminNavigation({ pathname }: { pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return <SidebarGroup><SidebarGroupContent><SidebarMenu>{navigation.map((item) => <SidebarMenuItem key={item.href}>
    <SidebarMenuButton isActive={pathname === item.href || (item.href !== "/admin/dashboard" && pathname.startsWith(`${item.href}/`))} onClick={() => { if (isMobile) setOpenMobile(false); }} render={<Link href={item.href} />}><item.icon /> <span>{item.label}</span></SidebarMenuButton>
  </SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>;
}
