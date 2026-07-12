/**
 * GetAppBanner — a slim, dismissible "get the app" nudge shown ONLY on the web
 * browser (hidden inside the Android TWA, iOS native app, and installed PWA).
 *
 * Part of the "smart nudge" web→app strategy: we don't block web (that would
 * break invite-link joins + churn existing web users); we nudge installs.
 * OS-aware: links to the App Store on iOS, Google Play on Android.
 */

import { useState } from "react";
import { X, Download } from "lucide-react";
import { isInTWA } from "@/lib/platform";
import { isIosNative } from "@/lib/iap";

const APP_STORE_URL = "https://apps.apple.com/app/spliiit/id6761338254";
const PLAY_URL = "https://play.google.com/store/apps/details?id=ca.klarityit.spliiit&pcampaignid=web_share";
const DISMISS_KEY = "spliiit_getapp_dismissed_at";
const RESHOW_MS = 7 * 24 * 60 * 60 * 1000; // re-show a week after dismissal

function isStandalonePWA(): boolean {
  try {
    return (window.matchMedia?.("(display-mode: standalone)")?.matches ?? false)
      || (navigator as any).standalone === true;
  } catch {
    return false;
  }
}

function storeLink(): string {
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return APP_STORE_URL;
  if (/Android/i.test(ua)) return PLAY_URL;
  return APP_STORE_URL; // desktop fallback
}

export function GetAppBanner() {
  // Web browser only — never in the TWA, iOS native, or an installed PWA.
  const isWeb = !isInTWA && !isIosNative && !isStandalonePWA();
  const [dismissed, setDismissed] = useState(() => {
    try {
      const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
      return ts > 0 && Date.now() - ts < RESHOW_MS;
    } catch {
      return false;
    }
  });

  if (!isWeb || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    setDismissed(true);
  };

  return (
    <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 flex items-center gap-3">
      <svg viewBox="0 0 32 32" fill="none" className="w-9 h-9 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
        <path d="M9 11h14M9 16h14M9 21h14" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight">Spliiit is better in the app</p>
        <p className="text-[11px] text-muted-foreground leading-tight">Payment reminders + faster splitting</p>
      </div>
      <a
        href={storeLink()}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold shrink-0 active:scale-95 transition-transform"
      >
        <Download className="w-3.5 h-3.5" /> Get
      </a>
      <button onClick={dismiss} aria-label="Dismiss" className="p-1 text-muted-foreground hover:text-foreground shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
