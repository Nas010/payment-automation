"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleAlertIcon, DatabaseIcon, LayoutDashboardIcon, PackageIcon, ReceiptTextIcon, ScrollTextIcon, SettingsIcon, UsersIcon } from "lucide-react";
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
    <Sidebar collapsible="offcanvas" variant="inset">
      <SidebarHeader className="px-3 py-4"><Link href="/admin/dashboard" className="flex items-center gap-2 px-2 text-base font-semibold tracking-tight"><span className="grid size-7 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"><DatabaseIcon /></span><span>Coaching Payments</span></Link></SidebarHeader>
      <Separator />
      <SidebarContent>
        <AdminNavigation pathname={pathname} />
      </SidebarContent>
      <SidebarFooter className="gap-3 p-3 text-xs text-sidebar-foreground/70"><Separator /><div className="flex flex-col gap-1"><p>Google Sheets · Connected</p><p>Admin session · Active</p></div><form action={logoutAction}><Button variant="ghost" size="sm" className="w-full justify-start">Sign out</Button></form></SidebarFooter>
    </Sidebar>
    <SidebarInset className="bg-muted/30"><header className="flex h-14 items-center gap-3 border-b bg-background px-4 md:px-6"><SidebarTrigger /><Separator orientation="vertical" className="h-4" /><span className="text-sm text-muted-foreground">Admin workspace</span></header><main className="mx-auto w-full max-w-[1440px] p-4 md:p-6">{children}</main></SidebarInset>
  </SidebarProvider>;
}

function AdminNavigation({ pathname }: { pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar();
  return <SidebarGroup><SidebarGroupContent><SidebarMenu>{navigation.map((item) => <SidebarMenuItem key={item.href}>
    <SidebarMenuButton isActive={pathname === item.href || (item.href !== "/admin/dashboard" && pathname.startsWith(`${item.href}/`))} onClick={() => { if (isMobile) setOpenMobile(false); }} render={<Link href={item.href} />}><item.icon /> <span>{item.label}</span></SidebarMenuButton>
  </SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>;
}
