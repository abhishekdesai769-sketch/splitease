/**
 * AdminLayout — responsive shell for the /admin section.
 *
 * Desktop (≥768px): persistent left sidebar (220px), icon + label per item.
 * Mobile (<768px):  hamburger button top-left → slide-in drawer.
 *
 * Section state is driven by the URL hash:
 *   #/admin           → home
 *   #/admin/home      → home
 *   #/admin/users     → users
 *   #/admin/ai-mode   → ai-mode
 *   #/admin/errors    → errors
 *   #/admin/campaigns → campaigns
 *
 * The parent page (admin.tsx) renders the appropriate content based on
 * the active section. This component just owns nav + chrome.
 */

import { useState, useEffect, type ReactNode } from "react";
import {
  Home, Users, Sparkles, AlertTriangle, Megaphone, Menu, X,
} from "lucide-react";

export type AdminSection = "home" | "users" | "ai-mode" | "errors" | "campaigns";

interface NavItem {
  id: AdminSection;
  label: string;
  icon: typeof Home;
  hash: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "home",      label: "Home",      icon: Home,           hash: "#/admin/home" },
  { id: "users",     label: "Users",     icon: Users,          hash: "#/admin/users" },
  { id: "ai-mode",   label: "AI Mode",   icon: Sparkles,       hash: "#/admin/ai-mode" },
  { id: "errors",    label: "Errors",    icon: AlertTriangle,  hash: "#/admin/errors" },
  { id: "campaigns", label: "Campaigns", icon: Megaphone,      hash: "#/admin/campaigns" },
];

/** Reads the active admin section from the URL hash. Defaults to "home"
 * for the bare /admin route, so deep links and back-button work. */
export function getActiveSection(): AdminSection {
  if (typeof window === "undefined") return "home";
  const hash = window.location.hash || "";
  // Match #/admin or #/admin/<section> or #/admin/users/<id> etc.
  const m = hash.match(/^#\/admin(?:\/([^/]+))?/);
  const seg = m?.[1] || "home";
  const known: AdminSection[] = ["home", "users", "ai-mode", "errors", "campaigns"];
  if ((known as string[]).includes(seg)) return seg as AdminSection;
  return "home";
}

interface AdminLayoutProps {
  children: ReactNode;
  pageTitle?: string;
}

export function AdminLayout({ children, pageTitle }: AdminLayoutProps) {
  const [active, setActive] = useState<AdminSection>(getActiveSection());
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Keep `active` in sync with the URL hash (browser back/forward, manual edits).
  useEffect(() => {
    const onHashChange = () => {
      setActive(getActiveSection());
      setDrawerOpen(false); // collapse the mobile drawer on navigation
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = (hash: string) => {
    // setting window.location.hash triggers the hashchange listener
    window.location.hash = hash;
  };

  return (
    <div className="flex min-h-[calc(100vh-8rem)] -mx-4">
      {/* ── Desktop sidebar (≥768px) ───────────────────────────────────── */}
      <aside
        className="hidden md:flex flex-col w-[220px] border-r border-border bg-muted/20 shrink-0"
        aria-label="Admin navigation"
      >
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
            Admin
          </p>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={active === item.id}
              onClick={() => navigate(item.hash)}
            />
          ))}
        </nav>
      </aside>

      {/* ── Mobile drawer (<768px) ─────────────────────────────────────── */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/40"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-[240px] bg-background border-r border-border transform transition-transform duration-200 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Admin navigation (drawer)"
      >
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
            Admin
          </p>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={active === item.id}
              onClick={() => navigate(item.hash)}
            />
          ))}
        </nav>
      </aside>

      {/* ── Content area ───────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 px-4 md:px-6 py-4">
        {/* Mobile-only top bar with hamburger + section label */}
        <div className="md:hidden flex items-center gap-2 mb-3 -mt-1">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1.5 rounded-lg border border-border hover:bg-muted/40"
            aria-label="Open admin menu"
          >
            <Menu className="w-4 h-4" />
          </button>
          {pageTitle && (
            <span className="text-sm font-semibold">{pageTitle}</span>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      }`}
      data-testid={`admin-nav-${item.id}`}
    >
      <item.icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
    </button>
  );
}
