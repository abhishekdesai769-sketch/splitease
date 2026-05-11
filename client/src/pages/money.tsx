/**
 * Money tab — placeholder UI shown to every logged-in user EXCEPT Android TWA.
 *
 * Visibility rules (enforced both here AND in Layout's navItems):
 *   - Premium users on iOS or web: SEE the early-access roadmap
 *   - Non-Premium users on iOS or web: SEE the teaser + upgrade CTA
 *   - Android TWA users: tab hidden + page redirects (Google Play payment
 *     policy; same rule we apply to every premium feature until v2 ships
 *     Play Billing)
 *
 * This file ships in 1.2.9 / 1.3.0 as a "Coming Soon — Beta" placeholder.
 *   - Premium users see "Thanks for being an early supporter"
 *   - Non-Premium users see "💎 This is a Premium feature" + Upgrade button
 *
 * Replaced incrementally (all premium-gated post-MVP):
 *   Week 2: InsightsHome.tsx (bank connection UI)
 *   Week 3+: triage UI, conversion flow, dashboard, AI Q&A
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { isInTWA } from "@/lib/platform";
import { Wallet, Sparkles, CheckCircle2, Circle, Loader2, Crown, Lock } from "lucide-react";

type RoadmapStatus = "done" | "in_progress" | "next" | "later";

interface RoadmapItem {
  label: string;
  detail: string;
  status: RoadmapStatus;
}

const ROADMAP: RoadmapItem[] = [
  {
    label: "Backend infrastructure",
    detail: "Database, sync engine, security",
    status: "in_progress",
  },
  {
    label: "Bank connection",
    detail: "Securely connect your accounts (read-only)",
    status: "next",
  },
  {
    label: "Transaction feed",
    detail: "See every transaction across all your banks",
    status: "next",
  },
  {
    label: "One-tap split",
    detail: "Turn any transaction into a Spliiit expense",
    status: "later",
  },
  {
    label: "Monthly summary",
    detail: "Where your money goes, top categories, top merchants",
    status: "later",
  },
  {
    label: "Ask anything (AI)",
    detail: '"Can I afford a $1000 trip in August?"',
    status: "later",
  },
];

function StatusIcon({ status }: { status: RoadmapStatus }) {
  if (status === "done") return <CheckCircle2 className="w-5 h-5 text-primary" />;
  if (status === "in_progress")
    return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
  return <Circle className="w-5 h-5 text-muted-foreground/40" />;
}

export default function MoneyPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // Defense-in-depth gate. Even if the tab is hidden in nav, anyone manually
  // navigating to /money inside the Android TWA gets bounced back to dashboard.
  // Non-Premium users are ALLOWED here (they see the upgrade teaser).
  useEffect(() => {
    if (!user) return;
    if (isInTWA) {
      setLocation("/");
    }
  }, [user, setLocation]);

  if (!user || isInTWA) {
    return null;
  }

  const isPremium = !!user.isPremium;

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
          {isPremium ? (
            <>
              We're building a way to track your money and one-tap split shared
              expenses — all in one place. You're getting early access because
              you're Premium.
            </>
          ) : (
            <>
              Track your money and one-tap split shared expenses — all in one
              place. Premium members get exclusive early access when it ships.
            </>
          )}
        </p>
      </div>

      {/* What's coming card — same for everyone (jealousy bait for free users) */}
      <div className="rounded-2xl border border-border bg-card/50 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          What's coming
        </h2>
        <ul className="space-y-4">
          {ROADMAP.map((item, idx) => (
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
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Honest expectations / FOMO */}
      <div className="rounded-2xl border border-border bg-card/30 p-5 text-center">
        <h3 className="text-sm font-semibold mb-2">
          {isPremium ? "Will I have to wait long?" : "When can I use it?"}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {isPremium ? (
            <>
              We're aiming for first usable beta in the next few weeks. As a
              Premium user, you'll get it as soon as it's ready — no extra
              charge, no waitlist. We'll send you an email + push notification
              when bank connections go live.
            </>
          ) : (
            <>
              Premium members get this the moment it ships — no waitlist, no
              extra charge. Free users will follow later. Upgrade to Premium
              to skip the line and be among the first to use it.
            </>
          )}
        </p>
      </div>

      {/* Trust note — same for everyone */}
      <div className="rounded-2xl border border-border bg-card/30 p-5">
        <h3 className="text-sm font-semibold mb-2">How will this work?</h3>
        <ul className="text-xs text-muted-foreground space-y-2 leading-relaxed">
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">✓</span>
            <span>
              <strong>Read-only access</strong> via Plaid (same tech as
              Wealthsimple, Robinhood, Mint)
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">✓</span>
            <span>
              We never see your bank password — Plaid handles it
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">✓</span>
            <span>You can disconnect any account at any time</span>
          </li>
          <li className="flex gap-2">
            <span className="text-primary font-bold shrink-0">✓</span>
            <span>
              <strong>Splitting stays free forever.</strong> Money is the
              new Premium feature, no change to the basics.
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
          <p className="text-sm font-semibold text-foreground">
            💎 This is a Premium feature
          </p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
            Money will launch as a Premium-only feature. Upgrade now to be
            among the first to use it when it ships.
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
