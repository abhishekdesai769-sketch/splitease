/**
 * ForceUpdateGate — blocks app usage when the installed version is too old.
 *
 * How it works:
 *   1. On native iOS startup, fetch /api/app/version-check
 *   2. Compare installed version (from Capacitor App plugin) against minimumVersion
 *   3. If installed < minimum: show a full-screen blocking overlay
 *
 * How to trigger a force update (no app release needed):
 *   → Render dashboard → Environment → set IOS_MINIMUM_VERSION=1.2.0 → Save
 *   → Render redeploys in ~30 seconds
 *   → All users on versions below 1.2.0 see the update screen next open
 *
 * Fail-open: if the API is unreachable or App.getInfo() fails, users are never blocked.
 */

import { useEffect, useState } from "react";
import { isIosNative } from "@/lib/iap";

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

const APP_STORE_URL = "https://apps.apple.com/app/spliiit/id6761338254";

export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  const [updateRequired, setUpdateRequired] = useState(false);
  const [storeUrl, setStoreUrl] = useState(APP_STORE_URL);

  useEffect(() => {
    if (!isIosNative) return; // web / Android — no version gate

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const [info, res] = await Promise.all([
          App.getInfo(),
          fetch("/api/app/version-check"),
        ]);

        if (!res.ok) return; // server error → fail open

        const data = await res.json();
        const minimum: string | undefined = data.ios?.minimumVersion;
        const url: string | undefined = data.ios?.storeUrl;

        if (url) setStoreUrl(url);

        if (minimum && compareVersions(info.version, minimum) < 0) {
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
      const { App } = await import("@capacitor/app");
      await App.exitApp();
    } catch {
      // Fallback: remove all content so the screen is blank
      document.body.innerHTML = "";
    }
  };

  return (
    <>
      {children}

      {updateRequired && (
        <div className="fixed inset-0 bg-background z-[9999] flex flex-col items-center justify-center p-8 text-center">
          {/* Logo */}
          <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center mb-6">
            <svg width="40" height="40" viewBox="0 0 32 32" fill="none" aria-label="Spliiit logo">
              <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
              <path d="M9 11h14M9 16h14M9 21h14" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
              <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
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
            Update on the App Store
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
