import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { isIosNative } from "@/lib/iap";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, ArrowLeft, Mail } from "lucide-react";

type AuthView = "login" | "signup" | "otp" | "forgot" | "forgot-sent";

// Logo — defined OUTSIDE AuthPage so it doesn't get re-created on every render
function Logo() {
  return (
    <div className="text-center space-y-2">
      <div className="flex items-center justify-center gap-2.5">
        <svg width="36" height="36" viewBox="0 0 32 32" fill="none" aria-label="Spliiit logo">
          <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
          <path d="M9 11h14M9 16h14M9 21h14" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
          <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="text-xl font-semibold tracking-tight text-foreground">
          Spl<span className="text-primary">iii</span>t
        </span>
      </div>
    </div>
  );
}

// Password input — defined OUTSIDE so React doesn't unmount/remount on every keystroke
function PasswordField({
  id, value, onChange, placeholder, show, onToggle, testId, minLen,
}: {
  id: string; value: string; onChange: (v: string) => void;
  placeholder: string; show: boolean; onToggle: () => void; testId: string;
  minLen?: number;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        minLength={minLen ?? 6}
        className="pr-10"
        data-testid={testId}
      />
      <button
        type="button"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        onClick={onToggle}
        tabIndex={-1}
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

export default function AuthPage() {
  const { login, signup, sendOtp, forgotPassword, refreshUser } = useAuth();
  const { toast } = useToast();
  const [view, setView] = useState<AuthView>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nativeAuthLoading, setNativeAuthLoading] = useState(false);

  const parseError = (err: any): string => {
    const msg = err.message || "Something went wrong";
    try {
      const json = JSON.parse(msg.split(": ").slice(1).join(": "));
      return json.error || msg;
    } catch {
      return msg;
    }
  };

  // ── Native Google Sign-In (Capacitor only — shows native account picker) ──
  const handleNativeGoogleSignIn = async () => {
    setNativeAuthLoading(true);
    try {
      const { GoogleAuth } = await import("@codetrix-studio/capacitor-google-auth");
      await GoogleAuth.initialize(); // safe to call multiple times
      const googleUser = await GoogleAuth.signIn();
      const idToken = googleUser.authentication.idToken;
      if (!idToken) throw new Error("No ID token returned");

      const res = await fetch("/api/auth/google/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Google sign-in failed");

      await refreshUser();
      window.location.hash = "#/";
    } catch (err: any) {
      // User cancelled — GoogleAuth throws with message containing "cancelled" / "cancel"
      if (err?.message?.toLowerCase().includes("cancel")) { setNativeAuthLoading(false); return; }
      toast({ title: "Google sign-in failed", description: parseError(err), variant: "destructive" });
    } finally {
      setNativeAuthLoading(false);
    }
  };

  // ── Sign in with Apple (Capacitor iOS only — required by App Store Guideline 4.8) ──
  const handleAppleSignIn = async () => {
    setNativeAuthLoading(true);
    try {
      const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
      const result = await SignInWithApple.authorize({
        clientId: "ca.klarityit.spliiit",
        redirectURI: "https://spliiit.klarityit.ca", // required by the plugin, not used for native
        scopes: "email name",
        state: "",
        nonce: "",
      });

      const { identityToken, givenName, familyName, email } = result.response;
      if (!identityToken) throw new Error("No identity token from Apple");

      const res = await fetch("/api/auth/apple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ identityToken, givenName, familyName, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apple sign-in failed");

      await refreshUser();
      window.location.hash = "#/";
    } catch (err: any) {
      // User cancelled the Apple sheet
      if (err?.message?.toLowerCase().includes("cancel") || err?.message?.toLowerCase().includes("dismiss")) {
        setNativeAuthLoading(false);
        return;
      }
      toast({ title: "Apple sign-in failed", description: parseError(err), variant: "destructive" });
    } finally {
      setNativeAuthLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("ghost_account")) {
        // Ghost user from Splitwise import — switch to signup with their email pre-filled
        setView("signup");
        toast({
          title: "Almost there!",
          description: "Your account was created from an import. Sign up with the same email to activate it — all your expenses will be there.",
        });
      } else {
        toast({
          title: "Login failed",
          description: "Invalid email or password. Tap 'Forgot password?' below if you need to reset it.",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: "Error", description: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      await sendOtp(name.trim(), email.trim());
      setView("otp");
      toast({ title: "Code sent", description: `Check ${email.trim()} for your verification code` });
    } catch (err: any) {
      toast({ title: "Error", description: parseError(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signup(name.trim(), email.trim(), password, otpCode.trim());
    } catch (err: any) {
      toast({ title: "Error", description: parseError(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setView("forgot-sent");
    } catch (err: any) {
      toast({ title: "Error", description: parseError(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setOtpCode("");
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const switchTo = (v: AuthView) => {
    resetForm();
    setView(v);
  };

  // ===== LOGIN & SIGNUP (tabbed) =====
  if (view === "login" || view === "signup") {
    const isLogin = view === "login";
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-1">
            <Logo />
            <p className="text-sm text-muted-foreground">Expense splitting made easy</p>
          </div>

          <Card className="p-6 space-y-5">
            {/* Tab switcher */}
            <div className="flex rounded-lg bg-muted/50 p-1">
              <button
                type="button"
                className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
                  isLogin
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => switchTo("login")}
                data-testid="tab-signin"
              >
                Sign In
              </button>
              <button
                type="button"
                className={`flex-1 text-sm font-medium py-2 rounded-md transition-colors ${
                  !isLogin
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => switchTo("signup")}
                data-testid="tab-signup"
              >
                Sign Up
              </button>
            </div>

            {isLogin ? (
              /* ---- Sign In form ---- */
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">Welcome back</h2>
                  <p className="text-sm text-muted-foreground">Sign in to your Spliiit account</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email" type="email" placeholder="you@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    required data-testid="input-email"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <PasswordField
                    id="login-password" value={password} onChange={setPassword}
                    placeholder="Enter your password" show={showPassword}
                    onToggle={() => setShowPassword(!showPassword)} testId="input-password"
                    minLen={1}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading} data-testid="auth-submit">
                  {loading ? "Signing in..." : "Sign In"}
                </Button>

                <button
                  type="button"
                  className="w-full text-sm text-primary hover:underline"
                  onClick={() => switchTo("forgot")}
                  data-testid="forgot-password-link"
                >
                  Forgot password?
                </button>
              </form>
            ) : (
              /* ---- Sign Up form ---- */
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">Create account</h2>
                  <p className="text-sm text-muted-foreground">Get started with Spliiit for free</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-name">Name</Label>
                  <Input
                    id="signup-name" placeholder="Your name"
                    value={name} onChange={(e) => setName(e.target.value)}
                    required data-testid="input-name"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email" type="email" placeholder="you@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    required data-testid="input-email"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <PasswordField
                    id="signup-password" value={password} onChange={setPassword}
                    placeholder="At least 6 characters" show={showPassword}
                    onToggle={() => setShowPassword(!showPassword)} testId="input-password"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-confirm">Confirm Password</Label>
                  <PasswordField
                    id="signup-confirm" value={confirmPassword} onChange={setConfirmPassword}
                    placeholder="Re-enter password" show={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword(!showConfirmPassword)} testId="input-confirm-password"
                  />
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-xs text-destructive">Passwords don't match</p>
                  )}
                </div>

                <Button
                  type="submit" className="w-full"
                  disabled={loading || !name.trim() || !email.trim() || password.length < 6 || password !== confirmPassword}
                  data-testid="auth-submit"
                >
                  {loading ? "Sending code..." : "Continue"}
                </Button>
              </form>
            )}
          {/* OR divider + Google button — shown on login and signup tabs */}
          <div className="px-6 pb-6 space-y-3">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-card px-3 text-muted-foreground">or</span>
              </div>
            </div>

            {/* Google — native account picker on Capacitor, browser redirect on web */}
            {isIosNative ? (
              <button
                onClick={handleNativeGoogleSignIn}
                disabled={nativeAuthLoading}
                className="flex items-center justify-center gap-3 w-full py-3 px-4 rounded-xl border border-border bg-background hover:bg-muted/50 transition-colors text-sm font-medium text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                {nativeAuthLoading ? "Signing in…" : "Continue with Google"}
              </button>
            ) : (
              <a
                href="/api/auth/google"
                className="flex items-center justify-center gap-3 w-full py-3 px-4 rounded-xl border border-border bg-background hover:bg-muted/50 transition-colors text-sm font-medium text-foreground"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </a>
            )}

            {/* Sign in with Apple — only shown on iOS native (App Store Guideline 4.8) */}
            {isIosNative && (
              <button
                onClick={handleAppleSignIn}
                disabled={nativeAuthLoading}
                className="flex items-center justify-center gap-3 w-full py-3 px-4 rounded-xl border border-border bg-foreground text-background hover:opacity-90 transition-opacity text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                </svg>
                {nativeAuthLoading ? "Signing in…" : "Sign in with Apple"}
              </button>
            )}
          </div>
          </Card>

          {/* Download the app — hidden inside the native app (you're already in it) */}
          {!isIosNative && <div className="space-y-3">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-background px-3 text-muted-foreground">Download the app</span>
              </div>
            </div>

            <a
              href="https://apps.apple.com/app/spliiit/id6761338254"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 w-full py-3 px-4 rounded-xl border border-border bg-foreground text-background hover:opacity-90 transition-opacity"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              <div className="text-left">
                <div className="text-xs opacity-75">Download on the</div>
                <div className="text-sm font-semibold leading-tight">App Store</div>
              </div>
            </a>

            <div className="flex items-center justify-center gap-3 w-full py-3 px-4 rounded-xl border border-border bg-muted/30 text-muted-foreground cursor-default select-none">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M3.18 23.76c.3.17.64.22.99.14l12.47-7.18-2.61-2.62-10.85 9.66zM.48 2.05C.18 2.4 0 2.93 0 3.61v16.78c0 .68.18 1.21.48 1.56l.08.08 9.4-9.4v-.22L.56 1.97l-.08.08zM20.49 10.27l-2.68-1.54-2.93 2.93 2.93 2.93 2.7-1.56c.77-.44.77-1.16-.02-1.76zM3.18.24L15.65 7.42l-2.61 2.61L2.19.37C2.5.2 2.88.07 3.18.24z" />
              </svg>
              <div className="text-left">
                <div className="text-xs opacity-75">Coming soon to</div>
                <div className="text-sm font-semibold leading-tight">Google Play</div>
              </div>
            </div>
          </div>}

        </div>
      </div>
    );
  }

  // ===== OTP VERIFICATION =====
  if (view === "otp") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <Logo />
          <p className="text-sm text-muted-foreground text-center">Verify your email</p>

          <Card className="p-6">
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <Mail className="w-6 h-6 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">
                  We sent a 6-digit code to<br />
                  <span className="font-medium text-foreground">{email}</span>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="otp-code">Verification Code</Label>
                <Input
                  id="otp-code" placeholder="000000"
                  value={otpCode} onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required maxLength={6}
                  className="text-center text-lg tracking-[0.3em] font-mono"
                  data-testid="input-otp"
                />
              </div>

              <Button
                type="submit" className="w-full"
                disabled={loading || otpCode.length !== 6}
                data-testid="verify-otp-submit"
              >
                {loading ? "Verifying..." : "Verify & Create Account"}
              </Button>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1"
                  onClick={() => setView("signup")}
                >
                  <ArrowLeft className="w-3 h-3" /> Back
                </button>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={async () => {
                    try {
                      await sendOtp(name.trim(), email.trim());
                      toast({ title: "Code resent", description: "Check your email for the new code" });
                    } catch (err: any) {
                      toast({ title: "Error", description: parseError(err), variant: "destructive" });
                    }
                  }}
                >
                  Resend code
                </button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  // ===== FORGOT PASSWORD =====
  if (view === "forgot") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <Logo />
          <p className="text-sm text-muted-foreground text-center">Reset your password</p>

          <Card className="p-6">
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <div className="space-y-2">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email" type="email" placeholder="you@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  required data-testid="input-forgot-email"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading || !email.trim()} data-testid="forgot-submit">
                {loading ? "Sending..." : "Send Reset Link"}
              </Button>

              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1"
                onClick={() => switchTo("login")}
              >
                <ArrowLeft className="w-3 h-3" /> Back to Sign In
              </button>
            </form>
          </Card>
        </div>
      </div>
    );
  }

  // ===== FORGOT PASSWORD - SENT =====
  if (view === "forgot-sent") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <Logo />

          <Card className="p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Mail className="w-6 h-6 text-primary" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold">Check your email</h3>
              <p className="text-sm text-muted-foreground">
                If an account exists for <span className="font-medium text-foreground">{email}</span>, we sent a password reset link.
              </p>
            </div>
            <Button variant="outline" className="w-full" onClick={() => switchTo("login")}>
              Back to Sign In
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return null;
}
