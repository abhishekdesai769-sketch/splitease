import { Switch, Route, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { trackPageView } from "@/lib/analytics";
import { recordReferralClick, matchReferralClick, isNativeApp } from "@/lib/referralFingerprint";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/dashboard";
import Friends from "@/pages/friends";
import Groups from "@/pages/groups";
import GroupDetail from "@/pages/group-detail";
import FriendDetail from "@/pages/friend-detail";
import Expenses from "@/pages/expenses";
import Admin from "@/pages/admin";
import AuthPage from "@/pages/auth";
import ResetPassword from "@/pages/reset-password";
import NotFound from "@/pages/not-found";
import Import from "@/pages/import";
import Upgrade from "@/pages/upgrade";
import Money from "@/pages/money";
import OnboardingPreferences from "@/pages/onboarding";
import FirstRunWizard from "@/pages/first-run";
import InvitePage from "@/pages/invite";
import { ReviewPromptSheet } from "@/components/ReviewPromptSheet";
import { ForceUpdateGate } from "@/components/ForceUpdateGate";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { isInTWA } from "@/lib/platform";
import { initDeepLinkHandling } from "@/lib/deeplink";

function AppRouter() {
  const { user, isLoading } = useAuth();
  const { syncFromDb } = useTheme();
  // Subscribe to hash changes so this component re-renders on navigation.
  // The body below reads window.location.hash directly, but without this
  // subscription AppRouter wouldn't re-run when the hash changes (e.g. when
  // the invite page sets hash="#/" to send a logged-out user to AuthPage).
  useHashLocation();

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
  // we stashed the code in localStorage. Once they're authenticated AND past onboarding,
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
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <svg width="36" height="36" viewBox="0 0 32 32" fill="none" aria-label="Loading" className="animate-pulse">
            <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
            <path d="M9 11h14M9 16h14M9 21h14" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
            <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      </div>
    );
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
    return <AuthPage />;
  }

  // Onboarding gate — show once for new users (and legacy users with no currency set)
  if (!user.defaultCurrency) {
    return <OnboardingPreferences />;
  }

  // First-run wizard gate — shown once between onboarding and dashboard, drives the
  // empty-app → real-group activation. Existing users were backfilled on startup
  // migration so they skip this. Wizard itself POSTs /api/user/first-run + refreshes
  // user, which falls back through to the routed Layout below.
  if (!user.firstRunCompletedAt) {
    return <FirstRunWizard />;
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
        <Route path="/invite/:code" component={InvitePage} />
        <Route path="/import" component={Import} />
        {/* /upgrade route is hidden inside the Android TWA — Google Play policy
            forbids non-Play payment UI in apps. Users see clean free product;
            payments happen on the web. (See lib/platform.ts.) */}
        <Route path="/upgrade">
          {() => (isInTWA ? <Redirect to="/" /> : <Upgrade />)}
        </Route>
        {/* /money — visible to all logged-in users EXCEPT Android TWA.
            The page itself renders two variants: Premium users see the
            early-access roadmap, non-Premium see the upgrade teaser.
            Defense-in-depth: money.tsx also checks isInTWA internally. */}
        <Route path="/money">
          {() => (isInTWA ? <Redirect to="/" /> : <Money />)}
        </Route>
        {user.isAdmin ? (
          <Route path="/admin" component={Admin} />
        ) : (
          <Route path="/admin">{() => <Redirect to="/" />}</Route>
        )}
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
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
