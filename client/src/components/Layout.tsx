import { Link, useLocation } from "wouter";
import { UsersRound, Receipt, LayoutDashboard, Users2, Sun, Moon, LogOut, Shield } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SupportDrawer } from "@/components/SupportDrawer";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <SupportDrawer>
            <button
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
              aria-label="Open menu"
              data-testid="logo-menu-trigger"
            >
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-label="Spliiit logo">
                <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
                <path d="M9 11h14M9 16h14M9 21h14" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
                <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="text-base font-semibold tracking-tight text-foreground">
                Spl<span className="text-primary">iii</span>t
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
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              data-testid="theme-toggle"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
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

      {/* Main content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-5 pb-24">
        {children}
      </main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-3xl mx-auto flex items-center justify-around h-16">
          {navItems.map((item) => {
            const isActive = location === item.path || 
              (item.path !== "/" && location.startsWith(item.path));
            return (
              <Link key={item.path} href={item.path}>
                <button
                  className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg transition-colors ${
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground"
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
    </div>
  );
}
