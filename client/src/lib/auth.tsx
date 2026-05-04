import { createContext, useContext, useCallback, useState, useEffect } from "react";
import type { SafeUser } from "@shared/schema";
import { apiRequest, queryClient } from "./queryClient";
import { identifyUser, resetIdentity, track } from "./analytics";
import { initRevenueCat } from "./iap";
import { initPushNotifications, deregisterPushToken } from "./push";

interface AuthContextType {
  user: SafeUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, otpCode: string) => Promise<void>;
  sendOtp: (name: string, email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<string>;
  resetPassword: (token: string, password: string) => Promise<string>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>; // re-fetch user from server (e.g. after onboarding)
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  login: async () => {},
  signup: async () => {},
  sendOtp: async () => {},
  forgotPassword: async () => "",
  resetPassword: async () => "",
  logout: async () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize RevenueCat whenever we have a logged-in user.
  // initRevenueCat is a no-op on web/Android and idempotent (runs once per session).
  useEffect(() => {
    if (user?.id) initRevenueCat(user.id);
  }, [user?.id]);

  // Register iOS push notifications when a user is logged in.
  // initPushNotifications is a no-op on web/Android. Asks for permission
  // on first run; subsequent runs reuse the existing token.
  useEffect(() => {
    if (user?.id) initPushNotifications(user.id);
  }, [user?.id]);

  // Check if user is logged in on mount
  useEffect(() => {
    fetch(
      ("__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__") + "/api/auth/me",
      { credentials: "include" }
    )
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => {
        if (data && data.id) setUser(data);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/login", { email, password });
    const data = await res.json();
    setUser(data);
    identifyUser(data.id, { name: data.name, email: data.email });
    track("user_logged_in");
    queryClient.clear();
    // Always navigate to dashboard after login to avoid stale hash routes (e.g. /#/admin)
    window.location.hash = "#/";
  }, []);

  const sendOtp = useCallback(async (name: string, email: string) => {
    await apiRequest("POST", "/api/auth/send-otp", { name, email });
  }, []);

  const signup = useCallback(async (name: string, email: string, password: string, otpCode: string) => {
    // Read UTM campaign and referral code captured on page load (survive the OTP step)
    const utmCampaign = localStorage.getItem("spliiit_utm_campaign") ?? undefined;
    const referredByCode = localStorage.getItem("spliiit_referral_code") ?? undefined;
    const res = await apiRequest("POST", "/api/auth/signup", {
      name, email, password, otpCode, utmCampaign,
      ...(referredByCode ? { referredByCode } : {}),
    });
    const data = await res.json();
    setUser(data);
    identifyUser(data.id, { name: data.name, email: data.email });
    track("user_signed_up");
    // Clear UTM and referral code after successful signup
    localStorage.removeItem("spliiit_utm_campaign");
    localStorage.removeItem("spliiit_referral_code");
    queryClient.clear();
    // Always navigate to dashboard after signup
    window.location.hash = "#/";
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    const res = await apiRequest("POST", "/api/auth/forgot-password", { email });
    const data = await res.json();
    return data.message;
  }, []);

  const resetPassword = useCallback(async (token: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/reset-password", { token, password });
    const data = await res.json();
    return data.message;
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await fetch(
      ("__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__") + "/api/auth/me",
      { credentials: "include" }
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.id) setUser(data);
    }
  }, []);

  const logout = useCallback(async () => {
    // Deregister the iOS push token BEFORE logging out so the server-side
    // delete is authenticated. No-op on web/Android. Wrapped in try so a
    // network blip can't block the actual logout.
    try {
      await deregisterPushToken();
    } catch { /* never block logout on push deregister */ }

    await apiRequest("POST", "/api/auth/logout");
    setUser(null);
    resetIdentity();
    queryClient.clear();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, sendOtp, forgotPassword, resetPassword, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
