import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Crown, Check, Loader2, ExternalLink, Repeat, Trash2, RotateCcw } from "lucide-react";
import { useHashLocation } from "wouter/use-hash-location";
import type { RecurringExpense } from "@shared/schema";
import { isIosNative, purchasePremium, restorePurchases, type IAPPlan } from "@/lib/iap";

type Plan = "monthly" | "yearly";

function PremiumDashboard({ until, premiumFeatures, portalMutation }: {
  until: string | null;
  premiumFeatures: string[];
  portalMutation: any;
}) {
  const { toast } = useToast();

  const { data: recurringList = [], isLoading: recurringLoading } = useQuery<RecurringExpense[]>({
    queryKey: ["/api/recurring"],
  });

  const cancelRecurringMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/recurring/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring"] });
      toast({ title: "Recurring expense cancelled" });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not cancel recurring expense.", variant: "destructive" });
    },
  });

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

      {/* Recurring Expenses Management */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Repeat className="w-4 h-4 text-primary" />
          <p className="text-sm font-medium">Recurring Expenses</p>
        </div>
        {recurringLoading ? (
          <div className="flex justify-center py-2">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : recurringList.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recurring expenses set up yet. Toggle "Repeat this expense" when adding an expense.
          </p>
        ) : (
          <ul className="space-y-2">
            {recurringList.map((rec) => (
              <li key={rec.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{rec.description}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    ${rec.amount.toFixed(2)} · {rec.frequency} · next {rec.nextRunDate}
                  </p>
                </div>
                <button
                  onClick={() => cancelRecurringMutation.mutate(rec.id)}
                  disabled={cancelRecurringMutation.isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  title="Cancel recurring expense"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
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

  const [isRestoring, setIsRestoring] = useState(false);

  // Stripe checkout — web + Android only
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

  // Apple IAP — iOS native only
  const iapMutation = useMutation({
    mutationFn: async (selectedPlan: IAPPlan) => {
      const result = await purchasePremium(selectedPlan);
      if (result.cancelled) throw new Error("__cancelled__");
      if (!result.success || !result.isPremium) {
        throw new Error(result.error ?? "Purchase did not complete. Please try again.");
      }
      const syncRes = await apiRequest("POST", "/api/apple-iap/sync", {
        isPremium: true,
        expirationDate: result.expirationDate ?? null,
      });
      return syncRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      toast({ title: "Welcome to Premium! 🎉", description: "All features are now unlocked." });
    },
    onError: (err: Error) => {
      if (err.message === "__cancelled__") return;
      toast({ title: "Purchase failed", description: err.message, variant: "destructive" });
    },
  });

  const handleRestore = async () => {
    setIsRestoring(true);
    try {
      const result = await restorePurchases();
      if (result.isPremium) {
        await apiRequest("POST", "/api/apple-iap/sync", {
          isPremium: true,
          expirationDate: result.expirationDate ?? null,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
        toast({ title: "Purchases restored! 🎉", description: "Your Premium access is active." });
      } else {
        toast({ title: "No active subscription found", description: "Nothing to restore.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Restore failed", description: err.message, variant: "destructive" });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleGetPremium = () => {
    if (isIosNative) {
      iapMutation.mutate(plan === "monthly" ? "monthly" : "yearly");
    } else {
      checkoutMutation.mutate(plan);
    }
  };

  const isPending = isIosNative ? iapMutation.isPending : checkoutMutation.isPending;

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
    "AI-powered receipt scan with item-level splitting",
    "Multi-currency expenses with live exchange rates",
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
    return <PremiumDashboard until={until} premiumFeatures={premiumFeatures} portalMutation={portalMutation} />;
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
          onClick={handleGetPremium}
          disabled={isPending || isRestoring}
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Crown className="w-4 h-4 mr-2" />
          )}
          {isPending ? "Processing..." : `Get Premium — ${plan === "monthly" ? monthlyCost + "/mo" : yearlyCost + "/yr"}`}
        </Button>

        {/* Restore Purchases — iOS only, required by App Store guidelines */}
        {isIosNative && (
          <button
            onClick={handleRestore}
            disabled={isPending || isRestoring}
            className="w-full py-1.5 text-xs text-muted-foreground flex items-center justify-center gap-1.5 hover:text-foreground transition-colors disabled:opacity-40"
          >
            {isRestoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            {isRestoring ? "Restoring…" : "Restore Purchases"}
          </button>
        )}

        <p className="text-xs text-center text-muted-foreground">
          Cancel any time ·{" "}
          {isIosNative ? "Billed via Apple App Store" : "Secure checkout via Stripe"}
        </p>
      </Card>
    </div>
  );
}
