/**
 * Money tab — bank connections for Premium users via Plaid.
 *
 * Visibility rules (enforced both here AND in Layout's navItems):
 *   - Premium users, Plaid live:     real Plaid Connect + connected accounts
 *   - Premium users, Plaid not live: "Connect" submits a request (no data collected),
 *                                    honest "we'll email you" confirmation
 *   - Non-Premium users:             "Connect" routes to the Premium upgrade wall
 *   - Android TWA users:             tab hidden + page redirects (Google Play payment policy)
 */

import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { isInTWA } from "@/lib/platform";
import { Wallet, Sparkles, CheckCircle2, Loader2, Crown, Lock, Trash2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PlaidLinkButton } from "@/components/PlaidLinkButton";

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
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  // Defense-in-depth — TWA users bounced even if they navigate here directly.
  useEffect(() => {
    if (!user) return;
    if (isInTWA) setLocation("/");
  }, [user, setLocation]);

  if (!user || isInTWA) return null;

  const isPremium = !!user.isPremium;

  // Fetch status — tells us whether Plaid is actually wired
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

  // Best-effort admin notification when a user requests a bank connection.
  // We don't block the UI on it — the confirmation shows regardless.
  const connectRequestMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/money/connect-request");
      return res.json();
    },
  });

  const plaidLive = statusQuery.data?.enabled === true;
  const items = accountsQuery.data?.items ?? [];
  const hasConnectedBanks = items.length > 0;

  // When Plaid is actually wired (dev/prod), Premium users get the real Connect + accounts flow.
  const showRealPlaid = isPremium && plaidLive;
  // Otherwise the Connect button either gates non-Premium to upgrade, or submits an
  // honest request for Premium users — no bank data is collected in this path.
  const showRequestFlow = !showRealPlaid;

  const handleConnect = () => {
    if (!isPremium) {
      setLocation("/upgrade");
      return;
    }
    connectRequestMutation.mutate();   // notify admin (best-effort)
    setRequestSubmitted(true);
  };

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
            Premium
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-600 text-xs font-medium mb-3">
            <Lock className="w-3.5 h-3.5" />
            Premium feature
          </div>
        )}

        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          {isPremium ? (
            <>Connect your bank accounts to see everything in one place — securely and read-only. Splitting stays free forever; Money is your Premium tracking layer.</>
          ) : (
            <>Connect your bank accounts and see everything in one place. Money is a Premium feature — splitting stays free forever.</>
          )}
        </p>
      </div>

      {/* ── Premium + Plaid live: real Connect / connected accounts ─────── */}
      {showRealPlaid && (
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

      {/* ── Request flow: non-Premium → upgrade wall; Premium → honest request ── */}
      {showRequestFlow && (
        requestSubmitted ? (
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 text-center space-y-3">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
              <CheckCircle2 className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-base font-semibold">Request received ✓</h2>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
              Your bank connection request has been made. We'll email you once it's approved — and then
              again to securely collect what's needed from your side to activate the connection.
            </p>
            <p className="text-[11px] text-muted-foreground/80 max-w-sm mx-auto">
              No bank details have been collected or connected yet.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-6 text-center space-y-4">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10">
              <Building2 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold mb-1">Connect your bank account</h2>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Securely via Plaid — read-only. We never see your password and can't move money.
              </p>
            </div>
            <Button onClick={handleConnect} className="w-full sm:w-auto">
              <Building2 className="w-4 h-4 mr-2" />
              Connect your bank account
            </Button>
          </div>
        )
      )}

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
            Money is exclusive to Premium members. Upgrade to unlock it.
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
