import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Crown, Check, Loader2, Zap, RefreshCw, ExternalLink } from "lucide-react";
import { useHashLocation } from "wouter/use-hash-location";

type Plan = "monthly" | "yearly";

export default function Upgrade() {
  const { toast } = useToast();
  const [plan, setPlan] = useState<Plan>("yearly");
  const [location] = useHashLocation();

  // Show success/cancel toasts from Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      toast({ title: "🎉 Welcome to Spliiit Premium!", description: "Your subscription is now active." });
      // Clean up URL
      window.history.replaceState({}, "", window.location.pathname + "#/upgrade");
    } else if (params.get("checkout") === "cancelled") {
      toast({ title: "Checkout cancelled", description: "You can upgrade any time.", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname + "#/upgrade");
    }
  }, []);

  const { data: status, isLoading: statusLoading } = useQuery<{ isPremium: boolean; premiumUntil: string | null }>({
    queryKey: ["/api/subscription/status"],
  });

  const checkoutMutation = useMutation({
    mutationFn: async (selectedPlan: Plan) => {
      const res = await apiRequest("POST", "/api/subscription/checkout", { plan: selectedPlan });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/subscription/portal");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: () => {
      toast({ title: "Error", description: "Could not open billing portal.", variant: "destructive" });
    },
  });

  const premiumFeatures = [
    "Recurring expenses (auto-create monthly bills)",
    "Smart payment reminders with tone control",
    "OCR receipt scanning from camera or gallery",
    "Cross-group balance view",
    "Priority support",
    "Early access to new features",
  ];

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Already premium — show management screen
  if (status?.isPremium) {
    const until = status.premiumUntil ? new Date(status.premiumUntil).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }) : null;
    return (
      <div className="space-y-5 max-w-md mx-auto">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-500" /> You're Premium
          </h1>
          {until && <p className="text-sm text-muted-foreground mt-0.5 font-mono">Active until {until}</p>}
        </div>

        <Card className="p-4 space-y-3">
          <p className="text-sm font-medium">Your premium features</p>
          <ul className="space-y-2">
            {premiumFeatures.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                {f}
              </li>
            ))}
          </ul>
        </Card>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => portalMutation.mutate()}
          disabled={portalMutation.isPending}
        >
          {portalMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-2" />}
          Manage Subscription
        </Button>
      </div>
    );
  }

  const monthlyCost = "CA$3.99";
  const yearlyCost = "CA$29.99";
  const yearlyMonthly = "CA$2.50";
  const saving = "37%";

  return (
    <div className="space-y-5 max-w-md mx-auto">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Upgrade to <span className="text-accent-foreground italic">Premium</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Unlock the full Spliiit experience.</p>
      </div>

      {/* Plan toggle */}
      <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
        <button
          className={`flex-1 py-2 transition-colors ${plan === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          onClick={() => setPlan("monthly")}
        >
          Monthly
        </button>
        <button
          className={`flex-1 py-2 transition-colors flex items-center justify-center gap-2 ${plan === "yearly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          onClick={() => setPlan("yearly")}
        >
          Yearly
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${plan === "yearly" ? "bg-amber-400 text-amber-900" : "bg-amber-100 text-amber-700"}`}>
            Save {saving}
          </span>
        </button>
      </div>

      {/* Pricing card */}
      <Card className="p-5 space-y-4">
        <div className="flex items-end gap-1">
          <span className="text-3xl font-bold font-mono">
            {plan === "monthly" ? monthlyCost : yearlyMonthly}
          </span>
          <span className="text-muted-foreground text-sm mb-1">/month</span>
        </div>
        {plan === "yearly" && (
          <p className="text-xs text-muted-foreground -mt-2 font-mono">
            Billed as {yearlyCost}/year
          </p>
        )}

        <ul className="space-y-2.5">
          {premiumFeatures.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <Check className="w-4 h-4 text-accent-foreground shrink-0 mt-0.5" />
              {f}
            </li>
          ))}
        </ul>

        <Button
          className="w-full"
          size="lg"
          onClick={() => checkoutMutation.mutate(plan)}
          disabled={checkoutMutation.isPending}
        >
          {checkoutMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Crown className="w-4 h-4 mr-2" />
          )}
          {checkoutMutation.isPending ? "Loading..." : `Get Premium — ${plan === "monthly" ? monthlyCost + "/mo" : yearlyCost + "/yr"}`}
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          Cancel any time · Secure checkout via Stripe
        </p>
      </Card>
    </div>
  );
}
