import { useState } from "react";
import { useAuth } from "@/lib/auth";
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
  const { login, signup, sendOtp, forgotPassword } = useAuth();
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

  const parseError = (err: any): string => {
    const msg = err.message || "Something went wrong";
    try {
      const json = JSON.parse(msg.split(": ").slice(1).join(": "));
      return json.error || msg;
    } catch {
      return msg;
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
          </Card>
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
