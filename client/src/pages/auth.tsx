import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, ArrowLeft, Mail } from "lucide-react";

type AuthView = "login" | "signup" | "otp" | "forgot" | "forgot-sent";

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
      toast({ title: "Error", description: parseError(err), variant: "destructive" });
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

  // Logo component
  const Logo = () => (
    <div className="text-center space-y-2">
      <div className="flex items-center justify-center gap-2.5">
        <svg width="36" height="36" viewBox="0 0 32 32" fill="none" aria-label="SplitEase logo">
          <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
          <path d="M10 11h12M10 16h12M10 21h12" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
          <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 3" />
        </svg>
        <span className="text-xl font-semibold tracking-tight text-foreground">
          Split<span className="text-primary">Ease</span>
        </span>
      </div>
    </div>
  );

  // Password input with eye toggle
  const PasswordInput = ({
    id, value, onChange, placeholder, show, onToggle, testId
  }: {
    id: string; value: string; onChange: (v: string) => void;
    placeholder: string; show: boolean; onToggle: () => void; testId: string;
  }) => (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        minLength={6}
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

  // ===== LOGIN =====
  if (view === "login") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <Logo />
          <p className="text-sm text-muted-foreground text-center">Welcome back</p>

          <Card className="p-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email" type="email" placeholder="you@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  required data-testid="input-email"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => switchTo("forgot")}
                    data-testid="forgot-password-link"
                  >
                    Forgot password?
                  </button>
                </div>
                <PasswordInput
                  id="password" value={password} onChange={setPassword}
                  placeholder="Enter password" show={showPassword}
                  onToggle={() => setShowPassword(!showPassword)} testId="input-password"
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading} data-testid="auth-submit">
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </Card>

          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <button className="text-primary font-medium hover:underline" onClick={() => switchTo("signup")} data-testid="auth-toggle">
              Sign Up
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ===== SIGNUP =====
  if (view === "signup") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">
          <Logo />
          <p className="text-sm text-muted-foreground text-center">Create your account</p>

          <Card className="p-6">
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name" placeholder="Your name"
                  value={name} onChange={(e) => setName(e.target.value)}
                  required data-testid="input-name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email" type="email" placeholder="you@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  required data-testid="input-email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password" value={password} onChange={setPassword}
                  placeholder="At least 6 characters" show={showPassword}
                  onToggle={() => setShowPassword(!showPassword)} testId="input-password"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <PasswordInput
                  id="confirm-password" value={confirmPassword} onChange={setConfirmPassword}
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
          </Card>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <button className="text-primary font-medium hover:underline" onClick={() => switchTo("login")} data-testid="auth-toggle">
              Sign In
            </button>
          </p>
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
                <Label htmlFor="otp">Verification Code</Label>
                <Input
                  id="otp" placeholder="000000"
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
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email" type="email" placeholder="you@example.com"
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
