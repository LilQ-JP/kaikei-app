/**
 * AppLayout — macOS Finder-style sidebar + main content layout
 * Design: macOS Ledger — frosted glass sidebar, clean white main area
 */

import { cn } from "@/lib/utils";
import {
  BarChart3,
  BookOpen,
  Calculator,
  FileText,
  Home,
  ImageIcon,
  Menu,
  Receipt,
  Settings,
  X,
  Download,
  ClipboardList,
} from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

interface NavItem {
  icon: React.ElementType;
  label: string;
  href: string;
  group: string;
}

const NAV_ITEMS: NavItem[] = [
  { icon: Home, label: "ダッシュボード", href: "/", group: "メイン" },
  { icon: BookOpen, label: "仕訳入力", href: "/journals/new", group: "メイン" },
  { icon: ClipboardList, label: "仕訳帳", href: "/journals", group: "帳簿" },
  { icon: BarChart3, label: "総勘定元帳", href: "/ledger", group: "帳簿" },
  { icon: Calculator, label: "試算表", href: "/trial-balance", group: "帳簿" },
  { icon: FileText, label: "損益計算書", href: "/pl", group: "決算" },
  { icon: FileText, label: "貸借対照表", href: "/bs", group: "決算" },
  { icon: Receipt, label: "請求書", href: "/invoices", group: "業務" },
  { icon: ImageIcon, label: "レシート", href: "/receipts", group: "業務" },
  { icon: FileText, label: "確定申告", href: "/tax-filing", group: "業務" },
  { icon: Settings, label: "勘定科目", href: "/accounts", group: "設定" },
  { icon: Download, label: "データ管理", href: "/data", group: "設定" },
  { icon: Settings, label: "事業者情報", href: "/profile", group: "設定" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const groups = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[240px] flex flex-col border-r border-sidebar-border bg-sidebar",
          "transition-transform duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]",
          "lg:relative lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* App title */}
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <Calculator className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-[15px] font-bold tracking-tight">フリーランス会計</span>
          <button
            className="ml-auto rounded-md p-1 hover:bg-sidebar-accent lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group} className="mb-4">
              <div className="mb-1.5 px-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                {group}
              </div>
              {items.map((item) => {
                const isActive =
                  item.href === "/"
                    ? location === "/"
                    : location.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] font-semibold transition-colors",
                        isActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      )}
                      onClick={() => setSidebarOpen(false)}
                    >
                      <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-sidebar-primary" : "")} />
                      {item.label}
                    </div>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-sidebar-border px-4 py-3">
          <div className="text-[11px] text-muted-foreground">
            データはブラウザに保存されます
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Top toolbar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 lg:px-6">
          <button
            className="rounded-md p-1.5 hover:bg-accent lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="text-[13px] font-semibold text-muted-foreground">
            {NAV_ITEMS.find((item) =>
              item.href === "/" ? location === "/" : location.startsWith(item.href)
            )?.label || ""}
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
