import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initAnalytics } from "./lib/analytics";

initAnalytics();

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
