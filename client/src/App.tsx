import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useEffect, useRef, useState } from "react";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { trackPageView, track } from "@/lib/analytics";
import { detectCurrency } from "@/lib/detect-currency";
import { recordReferralClick, matchReferralClick, isNativeApp } from "@/lib/referralFingerprint";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/dashboard";
import Friends from "@/pages/friends";
import Groups from "@/pages/groups";
import GroupDetail from "@/pages/group-detail";
import FriendDetail from "@/pages/friend-detail";
import Expenses from "@/pages/expenses";
import Admin from "@/pages/admin";
import { LandingGate } from "@/pages/landing";
import ResetPassword from "@/pages/reset-password";
import NotFound from "@/pages/not-found";
import Import from "@/pages/import";
import Upgrade from "@/pages/upgrade";
import AiMode from "@/pages/ai-mode";
// Only a fallback now — shown if the silent currency auto-set fails (see AppRouter).
// Onboarding is intentionally off while it's rebuilt from PostHog data; the
// first-run wizard (pages/first-run) and onboarding-v2 are kept but unhooked.
import OnboardingPreferences from "@/pages/onboarding";
import InvitePage from "@/pages/invite";
import { ReviewPromptSheet } from "@/components/ReviewPromptSheet";
import { ForceUpdateGate } from "@/components/ForceUpdateGate";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { isInTWA } from "@/lib/platform";
import { initDeepLinkHandling } from "@/lib/deeplink";

function BootLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <svg width="36" height="36" viewBox="0 0 32 32" fill="none" aria-label="Loading" className="animate-pulse">
          <rect width="32" height="32" rx="8" fill="hsl(30 6% 15%)" fillOpacity="0.06" />
          <circle cx="10" cy="8.8" r="1.5" fill="hsl(30 6% 15%)" />
          <path d="M10 13.6V23.8" stroke="hsl(30 6% 15%)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="16" cy="8.8" r="1.5" fill="hsl(30 6% 15%)" />
          <path d="M16 13.6V23.8" stroke="hsl(30 6% 15%)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="22" cy="8.8" r="1.5" fill="hsl(30 6% 15%)" />
          <path d="M22 13.6V23.8" stroke="hsl(30 6% 15%)" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    </div>
  );
}

function AppRouter() {
  const { user, isLoading, refreshUser } = useAuth();
  const { syncFromDb } = useTheme();
  // Subscribe to hash changes so this component re-renders on navigation.
  // The body below reads window.location.hash directly, but without this
  // subscription AppRouter wouldn't re-run when the hash changes (e.g. when
  // the invite page sets hash="#/" to send a logged-out user to AuthPage).
  useHashLocation();

  // No onboarding screens: a new user's home currency (locked server-side once
  // set) is picked silently from the device — see lib/detect-currency. Tried
  // once per session; if the save fails, the old currency picker is shown as a
  // fallback so nobody gets stuck on the loader.
  const currencyAutoSetTried = useRef(false);
  const [currencyAutoSetFailed, setCurrencyAutoSetFailed] = useState(false);
  useEffect(() => {
    if (!user || user.defaultCurrency || currencyAutoSetTried.current) return;
    currencyAutoSetTried.current = true;
    const guess = detectCurrency();
    apiRequest("POST", "/api/user/currency", { currency: guess.currency })
      .then(() => {
        track("currency_auto_set", { ...guess });
        return refreshUser();
      })
      .catch(async () => {
        // A 403 means it was already locked and our user object is stale.
        await refreshUser().catch(() => {});
        setCurrencyAutoSetFailed(true);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.defaultCurrency]);

  // Capture UTM params and referral codes from URL on first load.
  // Both survive the OTP step because they're stored in localStorage.
  // Also handles deferred deep-link attribution for native app installs.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const campaign = params.get("utm_campaign");
    if (campaign) localStorage.setItem("spliiit_utm_campaign", campaign);

    const ref = params.get("ref");
    if (ref) {
      localStorage.setItem("spliiit_referral_code", ref);
      // Record a fingerprint snapshot so this click can be matched after an App Store install
      recordReferralClick(ref);
    } else if (isNativeApp()) {
      // Native app opened with no ?ref= param — try to match a deferred click fingerprint.
      // If the user clicked a referral link on web before installing, this will find it.
      matchReferralClick();
    }
  }, []);

  // Sync theme from DB when user loads (cross-device consistency)
  useEffect(() => {
    if (user?.themePreference) {
      syncFromDb(user.themePreference);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Pending invite redirect — if a logged-out user clicked an invite link and then signed up,
  // we stashed the code in localStorage. Once they're authenticated AND their currency is set,
  // bounce them back to the invite page so they can complete the join.
  useEffect(() => {
    if (!user || !user.defaultCurrency) return;
    const pending = localStorage.getItem("spliiit_pending_invite");
    if (!pending) return;
    // Don't redirect if they're already on the right invite page
    if (window.location.hash.startsWith(`#/invite/${pending}`)) return;
    localStorage.removeItem("spliiit_pending_invite");
    window.location.hash = `#/invite/${pending}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.defaultCurrency]);

  if (isLoading) {
    return <BootLoader />;
  }

  if (!user) {
    // Check if this is a reset-password route
    const hash = window.location.hash;
    if (hash.startsWith("#/reset-password")) {
      return <ResetPassword />;
    }
    // Public invite preview — logged-out users can see the group they were invited to
    // before being asked to sign up. The InvitePage handles the "Sign up to join" CTA itself.
    if (hash.startsWith("#/invite/")) {
      return <InvitePage />;
    }
    return <LandingGate />;
  }

  // New users (and legacy users with no currency) wait a beat while the
  // currency is auto-set above; the picker only appears if that failed.
  if (!user.defaultCurrency) {
    return currencyAutoSetFailed ? <OnboardingPreferences /> : <BootLoader />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/friends" component={Friends} />
        <Route path="/friends/:id">
          {(params) => <FriendDetail friendId={params.id} />}
        </Route>
        <Route path="/groups" component={Groups} />
        <Route path="/groups/:id">
          {(params) => <GroupDetail groupId={params.id} />}
        </Route>
        <Route path="/expenses" component={Expenses} />
        <Route path="/ai" component={AiMode} />
        <Route path="/ai/:id" component={AiMode} />
        <Route path="/invite/:code" component={InvitePage} />
        <Route path="/import" component={Import} />
        {/* /upgrade route is hidden inside the Android TWA — Google Play policy
            forbids non-Play payment UI in apps. Users see clean free product;
            payments happen on the web. (See lib/platform.ts.) */}
        <Route path="/upgrade">
          {() => (isInTWA ? <Redirect to="/" /> : <Upgrade />)}
        </Route>
        {user.isAdmin ? (
          <>
            <Route path="/admin" component={Admin} />
            <Route path="/admin/:section" component={Admin} />
            <Route path="/admin/:section/:resourceId" component={Admin} />
          </>
        ) : (
          <>
            <Route path="/admin">{() => <Redirect to="/" />}</Route>
            <Route path="/admin/:section">{() => <Redirect to="/" />}</Route>
            <Route path="/admin/:section/:resourceId">{() => <Redirect to="/" />}</Route>
          </>
        )}
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

// Fades out the boot splash (rendered inline in index.html) the moment the app
// is actually ready — i.e. auth has resolved and AppRouter is about to paint the
// real first screen. The minimum on-screen time + hard cap live in the inline
// script in index.html; this just fires the "app is ready" signal. Lives under
// AuthProvider so it can read the auth loading state.
function BootSplashHider() {
  const { isLoading } = useAuth();
  useEffect(() => {
    if (!isLoading) {
      (window as any).__hideBootSplash?.();
    }
  }, [isLoading]);
  return null;
}

// Tracks page views on every hash route change
function PageViewTracker() {
  const [location] = useHashLocation();
  useEffect(() => {
    trackPageView(location);
  }, [location]);
  return null;
}

function App() {
  // iOS Universal Links — register the Capacitor appUrlOpen listener once,
  // as early as possible in the app lifecycle. No-op on web/Android.
  // Mirrors the lib/iap.ts and lib/push.ts native-only init pattern.
  useEffect(() => {
    initDeepLinkHandling();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeProvider>
          <AuthProvider>
            <BootSplashHider />
            <ForceUpdateGate>
              <Toaster />
              <ReviewPromptSheet />
              <Router hook={useHashLocation}>
                <PageViewTracker />
                <ErrorBoundary>
                  <AppRouter />
                </ErrorBoundary>
              </Router>
            </ForceUpdateGate>
          </AuthProvider>
        </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
