import { Link, useLocation } from "wouter";
import { Users, UsersRound, Receipt, LayoutDashboard, Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

const navItems = [
  { path: "/", icon: LayoutDashboard, label: "Dashboard" },
  { path: "/friends", icon: Users, label: "Friends" },
  { path: "/groups", icon: UsersRound, label: "Groups" },
  { path: "/expenses", icon: Receipt, label: "Expenses" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-label="SplitEase logo">
              <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
              <path d="M10 11h12M10 16h12M10 21h12" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
              <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
            </svg>
            <span className="text-base font-semibold tracking-tight text-foreground">
              Split<span className="text-primary">Ease</span>
            </span>
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            data-testid="theme-toggle"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
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
                  <item.icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{item.label}</span>
                </button>
              </Link>
            );
          })}
        </div>
      </nav>

      <footer className="pb-20 pt-4 text-center">
        <PerplexityAttribution />
      </footer>
    </div>
  );
}
