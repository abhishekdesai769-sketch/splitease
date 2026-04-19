import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Crown, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Plan = "monthly" | "yearly";

const FEATURES = [
  "Recurring expenses — auto-create monthly bills",
  "Smart payment reminders with tone control",
  "OCR receipt scanning from camera or gallery",
  "Cross-group balance view",
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
  const [plan, setPlan] = useState<Plan>("yearly");

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
            Yearly · CA$29.99
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                plan === "yearly"
                  ? "bg-amber-400 text-amber-900"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              Save 37%
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
          {checkoutMutation.isPending
            ? "Loading..."
            : `Get Premium — ${plan === "monthly" ? "CA$3.99/mo" : "CA$29.99/yr"}`}
        </Button>

        <p className="text-xs text-center text-muted-foreground mt-3">
          Cancel any time · Secure checkout via Stripe
        </p>
      </SheetContent>
    </Sheet>
  );
}
