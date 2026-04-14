/**
 * PostHog analytics wrapper for Spliiit.
 *
 * All functions are no-ops when VITE_POSTHOG_KEY is not set,
 * so analytics never throws or breaks the app.
 *
 * To enable: set VITE_POSTHOG_KEY in Render environment variables.
 */
import posthog from "posthog-js";

let initialized = false;

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return;
  posthog.init(key, {
    api_host: "https://us.i.posthog.com",
    person_profiles: "identified_only", // only create profiles for identified users
    capture_pageview: false,            // we handle this manually (hash routing)
    capture_pageleave: true,
    autocapture: true,                  // auto-tracks clicks & interactions
  });
  initialized = true;
}

/** Call after login or signup — links all events to this user. */
export function identifyUser(id: number, properties: { name: string; email: string }): void {
  if (!initialized) return;
  posthog.identify(String(id), { name: properties.name, email: properties.email });
}

/** Call after logout — disassociates events from the user. */
export function resetIdentity(): void {
  if (!initialized) return;
  posthog.reset();
}

/** Track a page view. Called on every hash route change. */
export function trackPageView(path: string): void {
  if (!initialized) return;
  posthog.capture("$pageview", { $current_url: window.location.href, path });
}

/** Track a named business event with optional properties. */
export function track(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}
