import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { UsersRound, Receipt, LayoutDashboard, Users2, LogOut, Shield } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SupportDrawer } from "@/components/SupportDrawer";
import { PushPermissionPrompt } from "@/components/PushPermissionPrompt";
import { GetAppBanner } from "@/components/GetAppBanner";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  // Incoming invite count for notification badge
  const { data: incomingInvites = [] } = useQuery<any[]>({
    queryKey: ["/api/invites/incoming"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/invites/incoming");
      return res.json();
    },
    enabled: !!user,
    refetchInterval: 30000, // poll every 30s for badge freshness
  });
  const inviteCount = incomingInvites.length;

  const navItems = [
    { path: "/", icon: LayoutDashboard, label: "Dashboard" },
    { path: "/friends", icon: Users2, label: "Friends" },
    { path: "/groups", icon: UsersRound, label: "Groups" },
    { path: "/expenses", icon: Receipt, label: "Expenses" },
    ...(user?.isAdmin ? [{ path: "/admin", icon: Shield, label: "Admin" }] : []),
  ];

  // Hide the bottom nav whenever the on-screen keyboard is open (renaming a
  // group, adding an expense, AI Mode, …) — a floating Dashboard/Friends bar
  // over the keyboard is clutter and you can't navigate mid-edit anyway. We
  // detect the keyboard via the visual viewport shrinking on mobile.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKeyboardOpen(window.innerHeight - vv.height > 120);
    vv.addEventListener("resize", onResize);
    onResize();
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // AI Mode is always a focused, full-screen chat, so hide the nav there
  // regardless of keyboard state too.
  const hideNav = keyboardOpen || location === "/ai" || location.startsWith("/ai/");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top header — pt-[env(safe-area-inset-top)] pushes the header content
          below the iOS notch/Dynamic Island. The bg fills the safe-area zone
          so the status-bar background looks intentional. */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md pt-[env(safe-area-inset-top)]">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <SupportDrawer>
            <button
              // No custom focus style here means the browser paints its
              // default blue outline when Radix restores focus to this
              // trigger after the menu closes — it then lingers around the
              // logo. Suppress that default outline; the drawer's
              // onCloseAutoFocus also keeps focus from landing here at all.
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity focus:outline-none focus-visible:outline-none"
              aria-label="Open menu"
              data-testid="logo-menu-trigger"
            >
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-label="Spliiit logo">
                <rect width="32" height="32" rx="8" fill="hsl(30 6% 15%)" fillOpacity="0.06" />
                <circle cx="10" cy="9.5" r="1.7" fill="hsl(30 6% 15%)" />
                <path d="M10 14v9" stroke="hsl(30 6% 15%)" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="16" cy="9.5" r="1.7" fill="hsl(18 42% 50%)" />
                <path d="M16 14v9" stroke="hsl(18 42% 50%)" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="22" cy="9.5" r="1.7" fill="hsl(30 6% 15%)" />
                <path d="M22 14v9" stroke="hsl(30 6% 15%)" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
              <span className="text-base font-semibold tracking-tight text-foreground">
                Spl<span className="text-accent-foreground">iii</span>t
              </span>
            </button>
          </SupportDrawer>
          <div className="flex items-center gap-1">
            {user && (
              <span className="text-xs text-muted-foreground mr-1 hidden sm:block truncate max-w-[120px]">
                {user.name}
              </span>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={logout}
              aria-label="Sign out"
              data-testid="logout-btn"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main content — pb-24 keeps content above the nav. Extra
          env(safe-area-inset-bottom) accounts for the home-indicator zone
          on iPhones with no physical button (now that contentInset is
          "never", we have to budget for that ourselves). */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-5 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <GetAppBanner />
        {children}
      </main>

      {/* Voice input lives inside AI Mode now (the /ai page). The global
          floating mic was replaced by a Mic button next to the AI Mode
          textarea — same Premium-gated speech-to-text, but as part of the
          conversational flow instead of a separate wizard. */}

      {/* Contextual notification-permission card / recovery banner.
          iOS-native only — renders nothing on web/Android. */}
      <PushPermissionPrompt />

      {/* Bottom navigation — pb-[env(safe-area-inset-bottom)] lifts the nav
          content above the home-indicator zone. The nav bg fills the safe
          area so the home-indicator area looks intentional, not like a gap. */}
      {!hideNav && (
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-3xl mx-auto flex items-center justify-around h-16">
          {navItems.map((item) => {
            const isActive = location === item.path ||
              (item.path !== "/" && location.startsWith(item.path));
            return (
              <Link key={item.path} href={item.path}>
                <button
                  className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                  data-testid={`nav-${item.label.toLowerCase()}`}
                >
                  <div className="relative">
                    <item.icon className="w-5 h-5" />
                    {item.label === "Dashboard" && inviteCount > 0 && (
                      <span
                        className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] rounded-full bg-red-500 flex items-center justify-center text-white"
                        style={{ fontSize: "9px", lineHeight: 1, padding: "0 2px" }}
                        data-testid="invite-badge"
                      >
                        {inviteCount > 9 ? "9+" : inviteCount}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-medium">{item.label}</span>
                </button>
              </Link>
            );
          })}
        </div>
      </nav>
      )}
    </div>
  );
}
