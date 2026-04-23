import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useTheme, type ThemePref } from "@/lib/theme";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CURRENCIES } from "@/components/CurrencySelector";
import { track } from "@/lib/analytics";

// ──────────────────────────────────────────────────────
// Logo (matches auth.tsx and Layout.tsx)
// ──────────────────────────────────────────────────────
function Logo() {
  return (
    <div className="flex items-center justify-center gap-2.5">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="Spliiit logo">
        <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
        <path d="M9 11h14M9 16h14M9 21h14" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="text-xl font-semibold tracking-tight text-foreground">
        Spl<span className="text-primary">iii</span>t
      </span>
    </div>
  );
}

// ──────────────────────────────────────────────────────
// Onboarding page — shown once after signup / for legacy users with no currency set
// ──────────────────────────────────────────────────────
export default function OnboardingPreferences() {
  const { refreshUser } = useAuth();
  const { themePref, setThemePref } = useTheme();
  const { toast } = useToast();

  const [currency, setCurrency] = useState("CAD");
  const [selectedTheme, setSelectedTheme] = useState<ThemePref>(themePref);
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const selectedCurrencyInfo = CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0];

  const filteredCurrencies = search.trim()
    ? CURRENCIES.filter(
        (c) =>
          c.code.toLowerCase().includes(search.toLowerCase()) ||
          c.name.toLowerCase().includes(search.toLowerCase())
      )
    : CURRENCIES;

  const handleThemeSelect = (pref: ThemePref) => {
    setSelectedTheme(pref);
    setThemePref(pref, false); // apply immediately for live preview, don't hit DB yet
  };

  const handleContinue = async () => {
    setLoading(true);
    try {
      // 1. Save currency (one-time, locked after this)
      await apiRequest("POST", "/api/user/currency", { currency });

      // 2. Save theme preference to DB
      await apiRequest("PATCH", "/api/user/preferences", { themePreference: selectedTheme });

      // 3. Apply theme fully (with DB save confirmation)
      setThemePref(selectedTheme, false); // already saved above

      // 4. Track onboarding completion
      track("onboarding_preferences_set", { currency, theme: selectedTheme });

      // 5. Refresh user in auth context so gate in App.tsx sees defaultCurrency set
      await refreshUser();

      // App.tsx will automatically re-render and show the dashboard
    } catch (err: any) {
      const msg = err?.message || "Something went wrong. Please try again.";
      let parsed = msg;
      try { parsed = JSON.parse(msg.split(": ").slice(1).join(": ")).error || msg; } catch {}
      toast({ title: "Error", description: parsed, variant: "destructive" });
      setLoading(false);
    }
  };

  const themeOptions: { pref: ThemePref; icon: React.ReactNode; label: string; sub: string }[] = [
    { pref: "light", icon: <Sun className="w-4 h-4" />, label: "Light", sub: "Always light" },
    { pref: "dark",  icon: <Moon className="w-4 h-4" />, label: "Dark", sub: "Always dark" },
    { pref: "system", icon: <Monitor className="w-4 h-4" />, label: "System", sub: "Follow device" },
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <Logo />
          <div className="pt-1">
            <h1 className="text-lg font-semibold text-foreground">Quick setup</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Two things before you dive in.
            </p>
          </div>
        </div>

        <Card className="p-6 space-y-6">
          {/* ── Section 1: Currency ── */}
          <div className="space-y-2.5">
            <div>
              <p className="text-sm font-semibold text-foreground">Home currency</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Default for all your new expenses. Can't be changed later to prevent abuse.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCurrencySheetOpen(true)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 transition-colors text-left"
            >
              <div>
                <span className="text-sm font-medium text-foreground">{selectedCurrencyInfo.name}</span>
                <span className="text-xs text-muted-foreground ml-2">({selectedCurrencyInfo.code})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-mono font-semibold text-primary">{selectedCurrencyInfo.symbol}</span>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </div>
            </button>
          </div>

          <div className="border-t border-border" />

          {/* ── Section 2: Theme ── */}
          <div className="space-y-2.5">
            <div>
              <p className="text-sm font-semibold text-foreground">Appearance</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick your preferred look. You can change this anytime from the menu.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {themeOptions.map(({ pref, icon, label, sub }) => (
                <button
                  key={pref}
                  type="button"
                  onClick={() => handleThemeSelect(pref)}
                  className={`relative flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all ${
                    selectedTheme === pref
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted/50"
                  }`}
                >
                  {selectedTheme === pref && (
                    <span className="absolute top-1.5 right-1.5">
                      <Check className="w-3 h-3 text-primary" />
                    </span>
                  )}
                  {icon}
                  <span className="text-xs font-semibold">{label}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight text-center">{sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── CTA ── */}
          <Button
            className="w-full"
            size="lg"
            onClick={handleContinue}
            disabled={loading}
          >
            {loading ? "Setting up…" : "Let's go →"}
          </Button>
        </Card>

        <p className="text-center text-xs text-muted-foreground px-4">
          Your home currency is locked after this to prevent accidental currency mixing.
          Contact support if you ever need to change it.
        </p>
      </div>

      {/* Currency picker sheet */}
      <Sheet open={currencySheetOpen} onOpenChange={(open) => { setCurrencySheetOpen(open); if (!open) setSearch(""); }}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[85vh] flex flex-col">
          <SheetHeader className="text-left pt-2 pb-3 flex-shrink-0">
            <SheetTitle>Select your home currency</SheetTitle>
          </SheetHeader>

          {/* Search */}
          <div className="px-1 pb-3 flex-shrink-0">
            <input
              type="text"
              placeholder="Search currencies…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-border bg-muted/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1 space-y-0.5 pb-6">
            {filteredCurrencies.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No currencies found</p>
            ) : (
              filteredCurrencies.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left ${
                    currency === c.code
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/60 text-foreground"
                  }`}
                  onClick={() => { setCurrency(c.code); setCurrencySheetOpen(false); setSearch(""); }}
                >
                  <span className="w-10 font-mono font-semibold text-sm shrink-0">{c.code}</span>
                  <span className="flex-1 text-sm text-muted-foreground">{c.name}</span>
                  <span className="text-sm font-medium shrink-0">{c.symbol}</span>
                  {currency === c.code && <Check className="w-4 h-4 text-primary shrink-0" />}
                </button>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
