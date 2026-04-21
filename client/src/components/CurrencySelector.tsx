import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Crown, ChevronDown, Check } from "lucide-react";

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: "CAD", name: "Canadian Dollar",      symbol: "CA$" },
  { code: "USD", name: "US Dollar",            symbol: "US$" },
  { code: "EUR", name: "Euro",                 symbol: "€"   },
  { code: "GBP", name: "British Pound",        symbol: "£"   },
  { code: "AUD", name: "Australian Dollar",    symbol: "A$"  },
  { code: "INR", name: "Indian Rupee",         symbol: "₹"   },
  { code: "MXN", name: "Mexican Peso",         symbol: "MX$" },
  { code: "JPY", name: "Japanese Yen",         symbol: "¥"   },
  { code: "CHF", name: "Swiss Franc",          symbol: "CHF" },
  { code: "NZD", name: "New Zealand Dollar",   symbol: "NZ$" },
  { code: "SGD", name: "Singapore Dollar",     symbol: "S$"  },
  { code: "HKD", name: "Hong Kong Dollar",     symbol: "HK$" },
];

interface Props {
  value: string;
  onChange: (currency: string) => void;
  isPremium?: boolean;
  onUpgrade?: () => void;
}

export function CurrencySelector({ value, onChange, isPremium, onUpgrade }: Props) {
  const [open, setOpen] = useState(false);

  const handleClick = () => {
    if (!isPremium) { onUpgrade?.(); return; }
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`flex items-center gap-1 text-xs font-semibold rounded-md px-2 py-1.5 border transition-colors ${
          isPremium
            ? "border-border hover:bg-muted/60 text-foreground"
            : "border-amber-400/50 text-amber-600 hover:bg-amber-50/10"
        }`}
        title={isPremium ? "Change currency" : "Upgrade to Premium for currency conversion"}
      >
        {!isPremium && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
        <span>{value}</span>
        <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-safe max-h-[80vh] overflow-y-auto">
          <SheetHeader className="text-left pt-2 pb-4">
            <SheetTitle>Select Currency</SheetTitle>
          </SheetHeader>
          <div className="space-y-0.5">
            {CURRENCIES.map((c) => (
              <button
                key={c.code}
                type="button"
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left ${
                  value === c.code
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/60 text-foreground"
                }`}
                onClick={() => { onChange(c.code); setOpen(false); }}
              >
                <span className="w-10 font-mono font-semibold text-sm shrink-0">{c.code}</span>
                <span className="flex-1 text-sm text-muted-foreground">{c.name}</span>
                <span className="text-sm font-medium shrink-0">{c.symbol}</span>
                {value === c.code && <Check className="w-4 h-4 text-primary shrink-0" />}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Format an expense's amount for display on cards.
 *  If currency is set (non-CAD), returns e.g. "US$50.00 → CA$68.49"
 *  Otherwise returns "CA$68.49" (or just the CAD amount). */
export function formatExpenseAmount(amount: number, currency?: string | null, originalAmount?: number | null): string {
  const cad = `CA$${amount.toFixed(2)}`;
  if (!currency || currency === "CAD" || !originalAmount) return cad;
  const info = CURRENCIES.find(c => c.code === currency);
  const sym = info?.symbol ?? currency;
  return `${sym}${originalAmount.toFixed(2)} → ${cad}`;
}
