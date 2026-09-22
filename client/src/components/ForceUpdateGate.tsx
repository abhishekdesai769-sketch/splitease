/**
 * ForceUpdateGate — blocks app usage when the installed native shell is too old.
 *
 * Two platforms, two version signals:
 *   • iOS  — Capacitor binary. Version from @capacitor/app App.getInfo().
 *   • Android — PWABuilder TWA (NOT Capacitor). The web content is always live,
 *     so only the native shell (icon/splash/intent config) can be stale. Its
 *     version is read via navigator.getInstalledRelatedApps() — which needs
 *     `related_applications` declared in manifest.json (Chrome 96+).
 *
 * Flow: fetch /api/app/version-check → read the installed version for this
 * platform → if installed < minimum, show a full-screen blocking overlay.
 *
 * How to trigger a force update (no app release needed):
 *   → Render dashboard → Environment →
 *       set IOS_MINIMUM_VERSION=1.2.0     (iOS)
 *       set ANDROID_MINIMUM_VERSION=1.2.0 (Android)
 *   → Render redeploys in ~30 seconds
 *   → Users on versions below the minimum see the update screen next open
 *
 * Fail-open, always: if the API is unreachable, the version can't be read, or
 * the platform doesn't support the signal, users are NEVER blocked.
 */

import { useEffect, useState } from "react";
import { isIosNative } from "@/lib/iap";
import { isInTWA } from "@/lib/platform";

// Simple semver comparator — returns -1 | 0 | 1
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

// navigator.getInstalledRelatedApps() — not yet in TS's lib.dom typings.
interface RelatedApp {
  platform?: string;
  id?: string;
  url?: string;
  version?: string;
}

const APP_STORE_URL = "https://apps.apple.com/app/spliiit/id6761338254";
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=ca.klarityit.spliiit";
const ANDROID_PACKAGE = "ca.klarityit.spliiit";

export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  const [updateRequired, setUpdateRequired] = useState(false);
  const [storeUrl, setStoreUrl] = useState(
    isIosNative ? APP_STORE_URL : PLAY_STORE_URL,
  );

  useEffect(() => {
    // Only native installs are gated. Plain web browsers are never blocked.
    if (!isIosNative && !isInTWA) return;

    (async () => {
      try {
        const res = await fetch("/api/app/version-check");
        if (!res.ok) return; // server error → fail open

        const data = await res.json();

        // ─── iOS (Capacitor) ──────────────────────────────────────────────
        if (isIosNative) {
          const { App } = await import("@capacitor/app");
          const info = await App.getInfo();
          const minimum: string | undefined = data.ios?.minimumVersion;
          const url: string | undefined = data.ios?.storeUrl;
          if (url) setStoreUrl(url);
          if (minimum && compareVersions(info.version, minimum) < 0) {
            setUpdateRequired(true);
          }
          return;
        }

        // ─── Android (PWABuilder TWA) ─────────────────────────────────────
        const minimum: string | undefined = data.android?.minimumVersion;
        const url: string | undefined = data.android?.storeUrl;
        if (url) setStoreUrl(url);
        if (!minimum) return;

        // getInstalledRelatedApps reports the installed native shell's version.
        // Unsupported browser / not declared → fail open (never block).
        const getInstalled = (navigator as any).getInstalledRelatedApps;
        if (typeof getInstalled !== "function") return;

        const apps: RelatedApp[] = await getInstalled.call(navigator);
        const self = apps.find(
          (a) => a.platform === "play" && a.id === ANDROID_PACKAGE,
        );
        const installedVersion = self?.version;
        if (!installedVersion) return; // version not reported → fail open

        if (compareVersions(installedVersion, minimum) < 0) {
          setUpdateRequired(true);
        }
      } catch {
        // Network error, plugin unavailable, etc. → fail open, never block user
      }
    })();
  }, []);

  const handleUpdate = () => {
    window.open(storeUrl, "_system");
  };

  const handleClose = async () => {
    try {
      if (isIosNative) {
        const { App } = await import("@capacitor/app");
        await App.exitApp();
        return;
      }
      // TWA / web have no reliable programmatic exit — blank the screen.
      window.close();
      document.body.innerHTML = "";
    } catch {
      document.body.innerHTML = "";
    }
  };

  const updateCta = isIosNative
    ? "Update on the App Store"
    : "Update on Google Play";

  return (
    <>
      {children}

      {updateRequired && (
        <div className="fixed inset-0 bg-background z-[9999] flex flex-col items-center justify-center p-8 text-center">
          {/* Logo */}
          <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-6">
            <svg width="40" height="40" viewBox="0 0 32 32" fill="none" aria-label="Spliiit logo">
              <rect width="32" height="32" rx="8" fill="hsl(30 6% 15%)" fillOpacity="0.06" />
              <circle cx="10" cy="8.8" r="1.5" fill="hsl(30 6% 15%)" />
              <path d="M10 13.6V23.8" stroke="hsl(30 6% 15%)" strokeWidth="3" strokeLinecap="round" />
              <circle cx="16" cy="8.8" r="1.5" fill="hsl(30 6% 15%)" />
              <path d="M16 13.6V23.8" stroke="hsl(30 6% 15%)" strokeWidth="3" strokeLinecap="round" />
              <circle cx="22" cy="8.8" r="1.5" fill="hsl(30 6% 15%)" />
              <path d="M22 13.6V23.8" stroke="hsl(30 6% 15%)" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-foreground mb-3">
            Update Required
          </h1>
          <p className="text-muted-foreground leading-relaxed mb-8 max-w-xs">
            A new version of Spliiit is available with important fixes and improvements.
            Please update to continue.
          </p>

          {/* Primary CTA */}
          <button
            onClick={handleUpdate}
            className="w-full max-w-xs py-4 bg-primary text-primary-foreground rounded-2xl text-base font-semibold hover:opacity-90 transition-opacity"
          >
            {updateCta}
          </button>

          {/* Close — iOS won't let apps truly quit, but this terminates the process */}
          <button
            onClick={handleClose}
            className="mt-5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Close app
          </button>
        </div>
      )}
    </>
  );
}
