/**
 * Web landing — app-first screen for COLD logged-out web visitors.
 *
 * Part of the "smart nudge" strategy: instead of dropping cold web visitors
 * straight into the sign-in form, we lead with the app pitch + store badges,
 * and demote sign-in to a secondary link. We deliberately DO NOT show this to:
 *   - the native app (TWA / iOS) or an installed PWA — they're already in,
 *   - invite-origin signups (pending invite) — never add friction to the
 *     viral join loop,
 *   - anyone who taps "Sign in" — they fall straight through to AuthPage.
 *
 * AuthPage itself is untouched; this only changes what a fresh browser visitor
 * sees first.
 */

import { useState } from "react";
import { isInTWA } from "@/lib/platform";
import { isIosNative } from "@/lib/iap";
import AuthPage from "@/pages/auth";
import { Sparkles, Bell, Users } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/app/spliiit/id6761338254";
const PLAY_URL = "https://play.google.com/store/apps/details?id=ca.klarityit.spliiit&pcampaignid=web_share";

function isStandalonePWA(): boolean {
  try {
    return (window.matchMedia?.("(display-mode: standalone)")?.matches ?? false)
      || (navigator as any).standalone === true;
  } catch {
    return false;
  }
}
function detectOS(): "ios" | "android" | "other" {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

const FEATURES = [
  { icon: Sparkles, title: "AI reads your receipts", body: "Snap a photo or drop a PDF — items split themselves." },
  { icon: Bell, title: "Auto-reminders", body: "Get paid back without the awkward ask." },
  { icon: Users, title: "Groups & friends", body: "Trips, roommates, dinners — settled in seconds." },
];

function Landing({ onSignIn }: { onSignIn: () => void }) {
  const os = detectOS();
  const primary = "bg-primary text-primary-foreground active:scale-95 transition-transform";
  const secondary = "bg-card border border-border text-foreground active:scale-95 transition-transform";
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center px-6 py-12 pt-[calc(3rem+env(safe-area-inset-top))]">
      <div className="w-full max-w-md flex flex-col items-center text-center">
        <img src="/icon-192.png" alt="Spliiit" className="w-16 h-16 rounded-2xl shadow-lg mb-5" />
        <h1 className="text-3xl font-semibold tracking-tight">Spl<span className="text-primary">iii</span>t</h1>
        <p className="text-muted-foreground mt-2 mb-8 text-[15px] leading-relaxed">
          Split expenses effortlessly with friends and groups — now with AI that reads your receipts.
        </p>

        <div className="w-full space-y-2.5">
          <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer"
             className={`flex items-center justify-center w-full py-3 rounded-xl font-semibold text-sm ${os === "android" ? secondary : primary}`}>
            Download on the App Store
          </a>
          <a href={PLAY_URL} target="_blank" rel="noopener noreferrer"
             className={`flex items-center justify-center w-full py-3 rounded-xl font-semibold text-sm ${os === "android" ? primary : secondary}`}>
            Get it on Google Play
          </a>
        </div>

        <div className="w-full mt-10 space-y-4 text-left">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-start gap-3">
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="text-xs text-muted-foreground">{f.body}</p>
              </div>
            </div>
          ))}
        </div>

        <button onClick={onSignIn} className="mt-10 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Prefer the browser? Sign in
        </button>
      </div>
    </div>
  );
}

export function LandingGate() {
  const [showSignIn, setShowSignIn] = useState(false);
  let hasPendingInvite = false;
  try { hasPendingInvite = !!localStorage.getItem("spliiit_pending_invite"); } catch { /* ignore */ }
  const isWeb = !isInTWA && !isIosNative && !isStandalonePWA();
  // App, invite-origin signup, or explicit "Sign in" → straight to the real form.
  if (!isWeb || hasPendingInvite || showSignIn) return <AuthPage />;
  return <Landing onSignIn={() => setShowSignIn(true)} />;
}
