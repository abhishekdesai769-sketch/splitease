import { formatMoney } from "@/components/CurrencySelector";
import { cn } from "@/lib/utils";

/**
 * Right-aligned amount for an expense row. A converted expense (entered in a
 * non-CAD currency) shows the base amount with what was entered on a small
 * line underneath — instead of one long "US$1,234.00 → $1,700.00" string
 * that crushes the description next to it on a phone.
 */
export function ExpenseAmount({
  amount,
  currency,
  originalAmount,
  viewerCurrency,
  className,
}: {
  amount: number;
  currency?: string | null;
  originalAmount?: number | null;
  viewerCurrency?: string | null;
  className?: string;
}) {
  const converted = !!currency && currency !== "CAD" && originalAmount != null;
  return (
    <span className={cn("shrink-0 text-right", className)}>
      <span className="block whitespace-nowrap">
        {formatMoney(amount, converted ? "CAD" : viewerCurrency)}
      </span>
      {converted && (
        <span className="block whitespace-nowrap font-mono text-[11px] font-normal text-muted-foreground">
          {formatMoney(originalAmount!, currency)}
        </span>
      )}
    </span>
  );
}
