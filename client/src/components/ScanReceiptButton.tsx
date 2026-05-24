import { useRef, useState } from "react";
import { Camera, Crown, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ReceiptReviewSheet, type Member, type ItemSplit } from "@/components/ReceiptReviewSheet";
import { triggerReview } from "@/lib/reviewPrompt";
import { isInTWA } from "@/lib/platform";
import { getDeviceId, getPlatformHint } from "@/lib/device-id";
import { track } from "@/lib/analytics";

interface ReceiptItem {
  name: string;
  price: number;
}

interface ReceiptData {
  merchant: string;
  date: string | null;
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  /** Server-generated audit row ID. Pass back when creating the expense so
   *  the server can commit the free-quota counter (only counts on actual
   *  expense creation, never on bare scans). */
  scanId?: string | null;
}

interface ScanResult {
  merchant: string;
  total: number | null;
  date?: string;
}

interface QuotaResponse {
  paid: boolean;
  allowed: boolean;
  freeRemaining: number;
  freeUsed: number;
  freeGranted: number;
}

interface ScanReceiptButtonProps {
  isPremium: boolean;
  onUpgrade: () => void;
  /** Group/friend members — enables "Split by items" in the review sheet */
  members?: Member[];
  /** Called when user completes per-item assignment in the review sheet.
   *  scanId is forwarded so the server can commit the free-quota counter
   *  when the expense is created. */
  onItemSplit?: (splits: ItemSplit[], scanId: string | null) => void;
  /** Called when user confirms a single-expense scan. The form is expected
   *  to AUTO-CREATE the expense from this data (no more "pre-fill the form"
   *  behavior — that confused free users into thinking nothing happened). */
  onResult: (data: ScanResult, file: File, scanId: string | null) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ScanReceiptButton({ isPremium, onUpgrade, members, onItemSplit, onResult }: ScanReceiptButtonProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [reviewData, setReviewData] = useState<ReceiptData | null>(null);
  const [reviewFile, setReviewFile] = useState<File | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch quota for non-premium users. Paid users skip the fetch entirely
  // (they have unlimited scans). TWA users also skip — feature is hidden for
  // them per Google Play compliance.
  const shouldFetchQuota = !isPremium && !isInTWA;
  const { data: quota } = useQuery<QuotaResponse>({
    queryKey: ["/api/scan-receipt/quota"],
    enabled: shouldFetchQuota,
    staleTime: 30 * 1000,
  });

  const handleFile = async (file: File) => {
    setIsScanning(true);
    track("ai_scan_attempted", {
      is_paid: isPremium,
      free_remaining_before: quota?.freeRemaining ?? null,
      file_size_kb: Math.round(file.size / 1024),
    });
    try {
      const imageBase64 = await fileToBase64(file);
      // Send device-id + platform headers so the server can enforce the
      // per-device cap (the user-cap is enforced regardless of headers).
      const res = await fetch("/api/scan-receipt", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": getDeviceId(),
          "X-Platform": getPlatformHint(),
        },
        body: JSON.stringify({
          imageBase64,
          mimeType: file.type || "image/jpeg",
        }),
      });
      if (!res.ok) {
        // 403 with reason=user_quota_exhausted / device_quota_exhausted → open paywall.
        if (res.status === 403) {
          // Refresh quota so the button re-renders into the paywall state.
          queryClient.invalidateQueries({ queryKey: ["/api/scan-receipt/quota"] });
          track("ai_scan_paywall_shown", { trigger: "server_403" });
          onUpgrade();
          return;
        }
        if (res.status === 429) {
          track("ai_scan_rate_limited", { is_paid: isPremium });
          throw new Error("Too many scans from this network — try again tomorrow.");
        }
        const err = await res.json().catch(() => ({ error: "Scan failed" }));
        track("ai_scan_failed", { is_paid: isPremium, status: res.status });
        throw new Error(err.error || "Scan failed");
      }
      const data: ReceiptData = await res.json();
      // Refresh quota — the successful scan ticked the counter down server-side.
      queryClient.invalidateQueries({ queryKey: ["/api/scan-receipt/quota"] });
      track("ai_scan_succeeded", {
        is_paid: isPremium,
        free_remaining_after: isPremium ? null : Math.max(0, (quota?.freeRemaining ?? 1) - 1),
        merchant: data.merchant ?? null,
        item_count: data.items?.length ?? 0,
        has_total: data.total != null,
      });
      // Show review sheet instead of immediately pre-filling
      setReviewData(data);
      setReviewFile(file);
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setIsScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleConfirm = (merchant: string, total: number, date?: string) => {
    if (!reviewFile) return;
    // Pass scanId so the form can include it in the create payload — server
    // commits the free-quota counter ONLY when an expense gets created.
    onResult({ merchant, total, date }, reviewFile, reviewData?.scanId ?? null);
    setTimeout(() => triggerReview("receipt"), 1500);
    setReviewData(null);
    setReviewFile(null);
  };

  const handleClose = () => {
    setReviewData(null);
    setReviewFile(null);
  };

  // ── Render decision ────────────────────────────────────────────────────────
  // TWA + non-premium: hide entirely (Google Play compliance — no premium
  // teaser UI in the Android TWA wrapper, even with free scans available).
  if (!isPremium && isInTWA) return null;

  // Free users: branch on quota state.
  //   - paid (false here, by definition) → never gets here
  //   - allowed === true  → primary scan button with counter label
  //   - allowed === false → upgrade button (the existing amber-dashed look)
  //   - quota still loading (data === undefined) → upgrade button as
  //     pessimistic default, swaps in on fetch (minimal visual jump for
  //     existing users)
  const isFreeWithQuota = !isPremium && quota?.allowed === true;
  const isFreeNoQuota = !isPremium && quota !== undefined && quota.allowed === false;

  // Compose the label for free users with quota remaining.
  // freeRemaining = 3 → "AI scan · 3 free scans"
  // freeRemaining = 2 → "AI scan · 2 of 3 free left"
  // freeRemaining = 1 → "AI scan · 1 free left"
  const freeQuotaLabel = (() => {
    if (!quota) return "AI scan · splits items for you";
    const r = quota.freeRemaining;
    if (r === quota.freeGranted) return `AI scan · ${r} free scans`;
    if (r === 1) return "AI scan · 1 free left";
    return `AI scan · ${r} of ${quota.freeGranted} free left`;
  })();

  // ── Free user, NO quota remaining → upgrade prompt ─────────────────────────
  if (isFreeNoQuota) {
    return (
      <button
        type="button"
        onClick={() => {
          track("ai_scan_paywall_shown", { trigger: "quota_exhausted_click" });
          onUpgrade();
        }}
        className="flex items-center gap-2 w-full rounded-lg border border-dashed border-amber-400/60 p-3 text-sm text-amber-600 hover:bg-amber-50/10 transition-colors"
      >
        <Camera className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">AI scan · splits items for you</span>
        <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
          <Crown className="w-3 h-3" /> Premium
        </span>
      </button>
    );
  }

  // ── Free user, quota still loading → pessimistic upgrade prompt ────────────
  // This matches the pre-Phase-3 behavior so existing users don't see a
  // flicker. The button swaps into the better label once quota arrives.
  if (!isPremium && !isFreeWithQuota) {
    return (
      <button
        type="button"
        onClick={onUpgrade}
        className="flex items-center gap-2 w-full rounded-lg border border-dashed border-amber-400/60 p-3 text-sm text-amber-600 hover:bg-amber-50/10 transition-colors"
      >
        <Camera className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">AI scan · splits items for you</span>
        <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
          <Crown className="w-3 h-3" /> Premium
        </span>
      </button>
    );
  }

  // ── Premium OR free-with-quota → the real scan button ──────────────────────
  // Same primary-teal styling. Label differs by tier:
  //   - Premium: "AI scan · splits items for you"
  //   - Free with quota: "AI scan · N of 3 free left"
  const label = isPremium ? "AI scan · splits items for you" : freeQuotaLabel;

  return (
    <>
      <label
        className={`flex items-center gap-2 w-full rounded-lg border border-dashed border-primary/40 p-3 text-sm text-primary cursor-pointer hover:bg-primary/5 transition-colors ${
          isScanning ? "opacity-70 pointer-events-none" : ""
        }`}
      >
        {isScanning ? (
          <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
        ) : (
          <Camera className="w-4 h-4 shrink-0" />
        )}
        <span className="flex-1">{isScanning ? "Scanning receipt…" : label}</span>
        {/* Premium badge on the free-quota button — sets the expectation
            that this is normally a paid feature, just being unlocked for trial. */}
        {!isPremium && (
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-mono text-primary/60">
            <Crown className="w-3 h-3" /> Premium
          </span>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={isScanning}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </label>

      {/* Review sheet — shown after successful scan */}
      {reviewData && (
        <ReceiptReviewSheet
          open={true}
          data={reviewData}
          members={members}
          onConfirm={handleConfirm}
          onItemSplit={onItemSplit ? (splits) => {
            // Forward the scanId so the form can pass it through to the
            // expense-create endpoints (server commits the counter there).
            onItemSplit(splits, reviewData?.scanId ?? null);
            setReviewData(null);
            setReviewFile(null);
          } : undefined}
          onClose={handleClose}
        />
      )}
    </>
  );
}
