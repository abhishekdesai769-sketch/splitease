import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Edit2 } from "lucide-react";

interface ReceiptItem {
  name: string;
  price: number;
}

interface ReceiptData {
  merchant: string;
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
}

interface ReceiptReviewSheetProps {
  open: boolean;
  data: ReceiptData;
  onConfirm: (merchant: string, total: number) => void;
  onClose: () => void;
}

export function ReceiptReviewSheet({ open, data, onConfirm, onClose }: ReceiptReviewSheetProps) {
  const [merchant, setMerchant] = useState(data.merchant);
  const [total, setTotal] = useState(String(data.total ?? ""));

  // Reset editable fields whenever new scan data comes in
  // (controlled by parent re-mounting or key prop)
  const handleConfirm = () => {
    const parsedTotal = parseFloat(total);
    if (!merchant.trim() || isNaN(parsedTotal) || parsedTotal <= 0) return;
    onConfirm(merchant.trim(), parsedTotal);
  };

  const parsedTotal = parseFloat(total);
  const isValid = merchant.trim().length > 0 && !isNaN(parsedTotal) && parsedTotal > 0;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl pb-8 px-5 max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left pt-2 pb-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            Review Scanned Receipt
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4">
          {/* Editable merchant */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Edit2 className="w-3 h-3" /> Merchant
            </Label>
            <Input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="Merchant name"
            />
          </div>

          {/* Editable total */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Edit2 className="w-3 h-3" /> Total Amount
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                className="pl-7"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Line items — read-only for verification */}
          {data.items.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Items detected</p>
              <div className="rounded-lg border border-border divide-y divide-border">
                {data.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="text-foreground flex-1 truncate pr-4">{item.name}</span>
                    <span className="font-mono text-muted-foreground shrink-0">
                      ${Number(item.price).toFixed(2)}
                    </span>
                  </div>
                ))}

                {/* Subtotal / tax breakdown if present */}
                {(data.subtotal != null || data.tax != null) && (
                  <>
                    {data.subtotal != null && (
                      <div className="flex items-center justify-between px-3 py-2 text-sm text-muted-foreground">
                        <span>Subtotal</span>
                        <span className="font-mono">${Number(data.subtotal).toFixed(2)}</span>
                      </div>
                    )}
                    {data.tax != null && (
                      <div className="flex items-center justify-between px-3 py-2 text-sm text-muted-foreground">
                        <span>Tax</span>
                        <span className="font-mono">${Number(data.tax).toFixed(2)}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Edit the merchant or amount above if anything looks off, then confirm.
          </p>

          <Button
            className="w-full"
            onClick={handleConfirm}
            disabled={!isValid}
          >
            Use This Receipt
          </Button>

          <button
            onClick={onClose}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            Cancel — scan again
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
