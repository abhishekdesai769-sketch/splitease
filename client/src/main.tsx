import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App";
import "./index.css";
import { initAnalytics } from "./lib/analytics";
import { logClientError } from "./lib/queryClient";

// ─── Legacy-domain redirect ────────────────────────────────────────────────
// spliiit.klarityit.ca (legacy) and spliiit.ca (canonical) serve the SAME app
// off one deploy. Send cold WEB visitors to spliiit.ca so there's one public
// address. Critically, we must NEVER redirect the installed native apps: the
// iOS Capacitor app loads its whole UI from klarityit and its session +
// deep-links are bound to that host, and the Android TWA is verified for that
// origin. Capacitor.isNativePlatform() is definitively true inside the iOS
// app; the TWA launches with an android-app:// referrer — exempt both.
const isLegacyWebVisitor =
  window.location.hostname === "spliiit.klarityit.ca" &&
  !Capacitor.isNativePlatform() &&
  !document.referrer.startsWith("android-app://");

if (isLegacyWebVisitor) {
  window.location.replace(
    "https://spliiit.ca" +
      window.location.pathname +
      window.location.search +
      window.location.hash,
  );
}

initAnalytics();

// ─── Global uncaught-exception logging ─────────────────────────────────────
// Catches JS errors that escape React boundaries (or fire outside React
// entirely — service worker, capacitor plugin callbacks, etc) so they show
// up in /admin → Recent Errors. Fire-and-forget, never affects UX.

window.addEventListener("error", (event) => {
  const msg = event.message || (event.error && event.error.message) || "Unknown error";
  // Skip known noise from third-party scripts / extensions
  if (msg.includes("ResizeObserver loop") || msg.includes("Script error.")) return;
  logClientError({
    errorCode: "js_uncaught_error",
    errorMessage: msg,
    contextJson: JSON.stringify({
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack?.slice(0, 2000),
    }),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason: any = event.reason;
  const msg = typeof reason === "string"
    ? reason
    : reason?.message || JSON.stringify(reason).slice(0, 500);
  logClientError({
    errorCode: "js_unhandled_rejection",
    errorMessage: msg,
    contextJson: JSON.stringify({
      stack: reason?.stack?.slice(0, 2000),
    }),
  });
});

if (!window.location.hash) {
  window.location.hash = "#/";
}

// Register service worker for PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Stale-chunk auto-recovery.
//
// After a Render redeploy, Vite gives the new JS chunks new content-hashed
// filenames (e.g. auth-DEF123.js replaces auth-ABC123.js). Users whose iOS
// WKWebView / browser cached the OLD index.html still reference the OLD
// chunk filenames. When a dynamic import() fires (e.g. GoogleAuth plugin
// on tap "Continue with Google"), the request hits a 404 and the SPA's
// catch-all returns index.html (Content-Type: text/html). The browser
// then throws: "'text/html' is not a valid JavaScript MIME type."
//
// Vite emits a `vite:preloadError` event whenever a chunk preload fails.
// Catching it + reloading the page is the canonical fix — it forces
// the cached index.html to refresh, picking up the new chunk hashes.
// Guard with sessionStorage so we don't infinite-loop on a real outage.
window.addEventListener("vite:preloadError", (event) => {
  const RELOAD_KEY = "spliiit_chunk_reload_at";
  const lastReload = parseInt(sessionStorage.getItem(RELOAD_KEY) || "0", 10);
  // Bail if we already reloaded within the last 10 seconds — prevents
  // pathological loops if the server itself is broken.
  if (Date.now() - lastReload < 10_000) {
    console.error("[chunk-reload] Repeated preload failure, aborting auto-reload:", event);
    return;
  }
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  console.warn("[chunk-reload] Stale chunk detected, reloading page");
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
