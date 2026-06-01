/**
 * CelebrationBanner — one-time in-app banner for milestone / promo campaigns.
 *
 * Fetches /api/user/campaigns/active on mount. If a banner is returned,
 * renders it as a dismissable card pinned to the top of the page below the
 * header. Tapping the CTA navigates to the campaign's ctaPath and marks the
 * banner dismissed. Tapping the X marks it dismissed without navigating.
 *
 * The dismiss state is server-side (campaign_sends table with channel
 * "banner_seen") so it persists across devices and sessions for that user.
 */

import { useState, useEffect } from "react";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ActiveBanner {
  campaignId: string;
  title: string;
  message: string;
  ctaLabel: string;
  ctaPath: string;
}

export function CelebrationBanner() {
  const [banner, setBanner] = useState<ActiveBanner | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiRequest("GET", "/api/user/campaigns/active")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.banner) setBanner(data.banner);
      })
      .catch(() => { /* silent — banner is not critical */ });
    return () => { cancelled = true; };
  }, []);

  const dismiss = async () => {
    if (!banner) return;
    setDismissed(true);
    try {
      await apiRequest("POST", `/api/user/campaigns/${banner.campaignId}/dismiss`);
    } catch { /* best-effort; UI is already hidden */ }
  };

  const handleCta = async () => {
    if (!banner) return;
    setDismissed(true);
    // Fire-and-forget dismiss, then navigate
    apiRequest("POST", `/api/user/campaigns/${banner.campaignId}/dismiss`).catch(() => {});
    window.location.hash = `#${banner.ctaPath}`;
  };

  if (!banner || dismissed) return null;

  return (
    <div
      className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-3.5 mb-4 relative overflow-hidden"
      data-testid="celebration-banner"
    >
      {/* Subtle decorative sparkle in the corner */}
      <div className="absolute -top-3 -right-3 w-16 h-16 rounded-full bg-primary/10 blur-2xl pointer-events-none" />

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-2 right-2 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <div className="shrink-0 w-9 h-9 rounded-xl bg-primary/20 flex items-center justify-center">
          <Sparkles className="w-4.5 h-4.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{banner.title}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{banner.message}</p>
          <button
            type="button"
            onClick={handleCta}
            className="inline-flex items-center gap-1 mt-2.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
          >
            {banner.ctaLabel}
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
