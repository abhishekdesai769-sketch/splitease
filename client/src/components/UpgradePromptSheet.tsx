import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Crown, Check, Loader2, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isIosNative, purchasePremium, restorePurchases, type IAPPlan } from "@/lib/iap";

type Plan = "monthly" | "yearly";

const FEATURES = [
  "Recurring expenses — auto-create monthly bills",
  "Smart payment reminders with tone control",
  "AI-powered receipt scan with item-level splitting",
  "Multi-currency expense converter",
  "Priority support & early access",
];

export function UpgradePromptSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<Plan>("yearly");
  const [isRestoring, setIsRestoring] = useState(false);

  // ── Stripe checkout (web + Android) ────────────────────────────────────────
  const stripeMutation = useMutation({
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

  // ── Apple IAP (iOS native only) ────────────────────────────────────────────
  const iapMutation = useMutation({
    mutationFn: async (selectedPlan: IAPPlan) => {
      const result = await purchasePremium(selectedPlan);
      if (result.cancelled) throw new Error("__cancelled__");
      if (!result.success || !result.isPremium) {
        throw new Error(result.error ?? "Purchase did not complete. Please try again.");
      }
      // Immediately sync premium status to our backend
      const syncRes = await apiRequest("POST", "/api/apple-iap/sync", {
        isPremium: true,
        expirationDate: result.expirationDate ?? null,
      });
      return syncRes.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      toast({
        title: "Welcome to Premium! 🎉",
        description: "All features are now unlocked.",
      });
      onClose();
    },
    onError: (err: Error) => {
      if (err.message === "__cancelled__") return; // user tapped Cancel — no toast
      toast({ title: "Purchase failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Restore purchases (iOS — required by App Store guidelines) ─────────────
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
        onClose();
      } else {
        toast({
          title: "No active subscription found",
          description: "Nothing to restore. If this is an error, contact support.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({ title: "Restore failed", description: err.message, variant: "destructive" });
    } finally {
      setIsRestoring(false);
    }
  };

  const isPending = isIosNative ? iapMutation.isPending : stripeMutation.isPending;

  const handleGetPremium = () => {
    if (isIosNative) {
      iapMutation.mutate(plan === "monthly" ? "monthly" : "yearly");
    } else {
      stripeMutation.mutate(plan);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8 px-5">
        <SheetHeader className="text-left pt-2 pb-4">
          <SheetTitle className="flex items-center gap-2 text-lg">
            <Crown className="w-5 h-5 text-amber-500" />
            Unlock Spliiit Premium
          </SheetTitle>
        </SheetHeader>

        {/* Plan toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium mb-4">
          <button
            className={`flex-1 py-2.5 transition-colors ${
              plan === "monthly"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => setPlan("monthly")}
          >
            Monthly · CA$3.99
          </button>
          <button
            className={`flex-1 py-2.5 transition-colors flex items-center justify-center gap-1.5 ${
              plan === "yearly"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
            onClick={() => setPlan("yearly")}
          >
            Yearly · CA$34.99
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                plan === "yearly"
                  ? "bg-amber-400 text-amber-900"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              Save 27%
            </span>
          </button>
        </div>

        {/* Feature list */}
        <ul className="space-y-2.5 mb-5">
          {FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              {f}
            </li>
          ))}
        </ul>

        {/* CTA button */}
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
          {isPending
            ? "Processing..."
            : `Get Premium — ${plan === "monthly" ? "CA$3.99/mo" : "CA$34.99/yr"}`}
        </Button>

        {/* Restore Purchases — iOS only, required by App Store guidelines */}
        {isIosNative && (
          <button
            onClick={handleRestore}
            disabled={isPending || isRestoring}
            className="w-full mt-3 py-1.5 text-xs text-muted-foreground flex items-center justify-center gap-1.5 hover:text-foreground transition-colors disabled:opacity-40"
          >
            {isRestoring ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RotateCcw className="w-3 h-3" />
            )}
            {isRestoring ? "Restoring…" : "Restore Purchases"}
          </button>
        )}

        <p className="text-xs text-center text-muted-foreground mt-3">
          Cancel any time ·{" "}
          {isIosNative ? "Billed via Apple App Store" : "Secure checkout via Stripe"}
        </p>
      </SheetContent>
    </Sheet>
  );
}
