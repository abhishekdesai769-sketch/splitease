/**
 * Money tab — bank connections for Premium users via Plaid.
 *
 * Visibility rules (enforced both here AND in Layout's navItems):
 *   - Premium users on iOS or web: Plaid Connect + connected accounts
 *   - Non-Premium users on iOS or web: roadmap teaser + upgrade CTA
 *   - Android TWA users: tab hidden + page redirects (Google Play payment policy)
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { isInTWA } from "@/lib/platform";
import { Wallet, Sparkles, CheckCircle2, Circle, Loader2, Crown, Lock, Trash2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";

type RoadmapStatus = "done" | "in_progress" | "next" | "later";

interface RoadmapItem {
  label: string;
  detail: string;
  status: RoadmapStatus;
}

interface PlaidAccount {
  id: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  isoCurrencyCode: string | null;
  lastSyncedAt: string;
}

interface PlaidItem {
  id: string;
  institutionName: string | null;
  institutionId: string | null;
  status: string;
  createdAt: string;
  accounts: PlaidAccount[];
}

interface MoneyStatus {
  enabled: boolean;
  stage: string;
  message: string;
  roadmap: Array<{ id: string; label: string; status: RoadmapStatus }>;
}

// Fallback roadmap when /status hasn't loaded yet (or for free users who can't fetch it)
const FALLBACK_ROADMAP: RoadmapItem[] = [
  { label: "Backend infrastructure", detail: "Database, sync engine, security", status: "done" },
  { label: "Bank connection",        detail: "Securely connect your accounts (read-only)", status: "in_progress" },
  { label: "Transaction feed",       detail: "See every transaction across all your banks", status: "next" },
  { label: "One-tap split",          detail: "Turn any transaction into a Spliiit expense", status: "later" },
  { label: "Monthly summary",        detail: "Where your money goes, top categories, top merchants", status: "later" },
  { label: "Ask anything (AI)",      detail: '"Can I afford a $1000 trip in August?"', status: "later" },
];

function StatusIcon({ status }: { status: RoadmapStatus }) {
  if (status === "done") return <CheckCircle2 className="w-5 h-5 text-primary" />;
  if (status === "in_progress") return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
  return <Circle className="w-5 h-5 text-muted-foreground/40" />;
}

function formatCurrency(amount: number | null, code: string | null): string {
  if (amount === null) return "—";
  const sign = amount < 0 ? "-" : "";
  const value = Math.abs(amount).toFixed(2);
  const symbol = code === "USD" ? "$" : code === "CAD" ? "$" : code === "EUR" ? "€" : code === "GBP" ? "£" : "$";
  return `${sign}${symbol}${value}${code && code !== "CAD" && code !== "USD" ? ` ${code}` : ""}`;
}

function formatType(type: string, subtype: string | null): string {
  if (subtype) {
    return subtype.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export default function MoneyPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingDisconnect, setPendingDisconnect] = useState<string | null>(null);

  // Defense-in-depth — TWA users bounced even if they navigate here directly.
  useEffect(() => {
    if (!user) return;
    if (isInTWA) setLocation("/");
  }, [user, setLocation]);

  if (!user || isInTWA) return null;

  const isPremium = !!user.isPremium;

  // Fetch status — drives the roadmap + tells us whether Plaid is wired
  const statusQuery = useQuery<MoneyStatus>({
    queryKey: ["/api/money/status"],
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  // Fetch connected accounts — Premium-only. Returns 503 if Plaid not configured.
  const accountsQuery = useQuery<{ items: PlaidItem[] }>({
    queryKey: ["/api/money/accounts"],
    enabled: isPremium && statusQuery.data?.enabled === true,
    staleTime: 30 * 1000,
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await apiRequest("DELETE", `/api/money/items/${itemId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/money/accounts"] });
      toast({ title: "Bank disconnected" });
      setPendingDisconnect(null);
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).message || msg; } catch {}
      toast({ title: "Couldn't disconnect", description: msg, variant: "destructive" });
      setPendingDisconnect(null);
    },
  });

  const plaidLive = statusQuery.data?.enabled === true;
  const items = accountsQuery.data?.items ?? [];
  const hasConnectedBanks = items.length > 0;
  const roadmap: RoadmapItem[] = statusQuery.data?.roadmap
    ? statusQuery.data.roadmap.map((r) => ({
        label: r.label,
        detail: FALLBACK_ROADMAP.find((f) => f.label === r.label)?.detail ?? "",
        status: r.status,
      }))
    : FALLBACK_ROADMAP;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="text-center pt-4 pb-2">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
          <Wallet className="w-7 h-7 text-primary" />
        </div>

        <h1 className="text-3xl font-semibold tracking-tight mb-2">Money</h1>

        {isPremium ? (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            Premium · Beta · Early access
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 text-xs font-medium mb-3">
            <Lock className="w-3.5 h-3.5" />
            Premium-only · Coming soon
          </div>
        )}

        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          {isPremium && plaidLive ? (
            <>Connect your bank accounts to see everything in one place. Splitting stays free forever — Money adds the tracking layer.</>
          ) : isPremium ? (
            <>We're building a way to track your money and one-tap split shared expenses — all in one place. You're getting early access because you're Premium.</>
          ) : (
            <>Track your money and one-tap split shared expenses — all in one place. Premium members get exclusive early access when it ships.</>
          )}
        </p>
      </div>

      {/* ── Premium + Plaid live: Connect / connected accounts ─────────── */}
      {isPremium && plaidLive && (
        <>
          {/* Empty state — no banks yet */}
          {!hasConnectedBanks && !accountsQuery.isLoading && (
            <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-6 text-center space-y-4">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
                <Building2 className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold mb-1">Connect your first bank</h2>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Securely via Plaid. We're read-only — we'll never see your password and can't move money.
                </p>
              </div>
              <PlaidLinkButton variant="primary" />
            </div>
          )}

          {/* Loading skeleton */}
          {accountsQuery.isLoading && (
            <div className="rounded-2xl border border-border bg-card/50 p-6 text-center">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              <p className="text-xs text-muted-foreground mt-2">Loading accounts…</p>
            </div>
          )}

          {/* Connected banks list */}
          {hasConnectedBanks && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground px-1">
                Connected ({items.length} bank{items.length !== 1 ? "s" : ""})
              </h2>
              {items.map((item) => (
                <div key={item.id} className="rounded-2xl border border-border bg-card/50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="font-medium text-sm truncate">{item.institutionName || "Bank"}</span>
                      {item.status !== "active" && (
                        <span className="text-[10px] uppercase font-semibold text-amber-600 px-1.5 py-0.5 rounded bg-amber-500/10">
                          {item.status}
                        </span>
                      )}
                    </div>
                    {pendingDisconnect === item.id ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => disconnectMutation.mutate(item.id)}
                          disabled={disconnectMutation.isPending}
                        >
                          {disconnectMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Disconnect"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPendingDisconnect(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDisconnect(item.id)}
                        className="p-1.5 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        title="Disconnect"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-border">
                    {item.accounts.map((a) => (
                      <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{a.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {formatType(a.type, a.subtype)}
                            {a.mask ? ` · •••• ${a.mask}` : ""}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold font-mono">
                            {formatCurrency(a.currentBalance, a.isoCurrencyCode)}
                          </p>
                          {a.availableBalance !== null && a.availableBalance !== a.currentBalance && (
                            <p className="text-[10px] text-muted-foreground">
                              {formatCurrency(a.availableBalance, a.isoCurrencyCode)} avail
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <PlaidLinkButton variant="secondary" />
            </div>
          )}
        </>
      )}

      {/* What's coming — visible to everyone (FOMO for free users, progress signal for Premium) */}
      <div className="rounded-2xl border border-border bg-card/50 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          What's coming
        </h2>
        <ul className="space-y-4">
          {roadmap.map((item, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                <StatusIcon status={item.status} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{item.label}</span>
                  {item.status === "in_progress" && (
                    <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">
                      Building now
                    </span>
                  )}
                  {item.status === "done" && (
                    <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">
                      Live
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Trust note — same for everyone */}
      <div className="rounded-2xl border border-border bg-card/30 p-5">
        <h3 className="text-sm font-semibold mb-2">How does this work?</h3>
        <ul className="text-xs text-muted-foreground space-y-2 leading-relaxed">
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">✓</span>
            <span>
              <strong>Read-only access</strong> via Plaid (same tech as Wealthsimple, Robinhood, Mint)
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">✓</span>
            <span>We never see your bank password — Plaid handles it</span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">✓</span>
            <span>You can disconnect any account at any time</span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">✓</span>
            <span>
              <strong>Splitting stays free forever.</strong> Money is the new Premium feature, no change to the basics.
            </span>
          </li>
        </ul>
      </div>

      {/* Footer — premium thanks vs upgrade CTA */}
      {isPremium ? (
        <div className="text-center pt-2 pb-8">
          <p className="text-[11px] text-muted-foreground">
            Thanks for being an early supporter ⭐
          </p>
        </div>
      ) : (
        <div className="text-center pt-2 pb-8 space-y-3">
          <p className="text-sm font-semibold text-foreground">💎 This is a Premium feature</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
            Money is exclusive to Premium members. Upgrade to unlock it the moment it ships.
          </p>
          <button
            onClick={() => setLocation("/upgrade")}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:scale-95 transition-all shadow-sm"
            data-testid="upgrade-from-money-cta"
          >
            <Crown className="w-4 h-4" />
            Upgrade to Premium
          </button>
        </div>
      )}
    </div>
  );
}
