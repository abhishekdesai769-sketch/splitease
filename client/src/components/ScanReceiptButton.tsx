import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ReceiptReviewSheet, type Member, type ItemSplit } from "@/components/ReceiptReviewSheet";
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

interface ScanReceiptButtonProps {
  /** Kept for call-site compatibility; AI scan is available to everyone
   *  (bounded server-side by the per-IP daily scan limit). */
  isPremium?: boolean;
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

export function ScanReceiptButton({ members, onItemSplit, onResult }: ScanReceiptButtonProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [reviewData, setReviewData] = useState<ReceiptData | null>(null);
  const [reviewFile, setReviewFile] = useState<File | null>(null);
  const { toast } = useToast();

  const handleFile = async (file: File) => {
    setIsScanning(true);
    track("ai_scan_attempted", { file_size_kb: Math.round(file.size / 1024) });
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
        if (res.status === 429) {
          track("ai_scan_rate_limited");
          throw new Error("Too many scans from this network — try again tomorrow.");
        }
        const err = await res.json().catch(() => ({ error: "Scan failed" }));
        track("ai_scan_failed", { status: res.status });
        throw new Error(err.error || "Scan failed");
      }
      const data: ReceiptData = await res.json();
      track("ai_scan_succeeded", {
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
    setReviewData(null);
    setReviewFile(null);
  };

  const handleClose = () => {
    setReviewData(null);
    setReviewFile(null);
  };

  // Everyone gets the scan (Sept 2026 — no in-app upsells). Cost is bounded
  // server-side by the per-IP daily scan limit.
  const label = "AI scan · splits items for you";

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
