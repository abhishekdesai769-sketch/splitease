import { createContext, useContext, useCallback, useState, useEffect } from "react";
import type { SafeUser } from "@shared/schema";
import { apiRequest, queryClient } from "./queryClient";
import { identifyUser, resetIdentity, track } from "./analytics";

interface AuthContextType {
  user: SafeUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, otpCode: string) => Promise<void>;
  sendOtp: (name: string, email: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<string>;
  resetPassword: (token: string, password: string) => Promise<string>;
  logout: () => Promise<void>;
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
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
    const res = await apiRequest("POST", "/api/auth/signup", { name, email, password, otpCode });
    const data = await res.json();
    setUser(data);
    identifyUser(data.id, { name: data.name, email: data.email });
    track("user_signed_up");
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

  const logout = useCallback(async () => {
    await apiRequest("POST", "/api/auth/logout");
    setUser(null);
    resetIdentity();
    queryClient.clear();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, signup, sendOtp, forgotPassword, resetPassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
