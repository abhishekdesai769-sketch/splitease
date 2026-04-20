import { useRef, useState } from "react";
import { Camera, Crown, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ReceiptReviewSheet, type Member, type ItemSplit } from "@/components/ReceiptReviewSheet";

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
}

interface ScanResult {
  merchant: string;
  total: number | null;
  date?: string;
}

interface ScanReceiptButtonProps {
  isPremium: boolean;
  onUpgrade: () => void;
  /** Group/friend members — enables "Split by items" in the review sheet */
  members?: Member[];
  /** Called when user completes per-item assignment in the review sheet */
  onItemSplit?: (splits: ItemSplit[]) => void;
  /** Called with extracted data and the original File (for attaching to expense) */
  onResult: (data: ScanResult, file: File) => void;
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

  const handleFile = async (file: File) => {
    setIsScanning(true);
    try {
      const imageBase64 = await fileToBase64(file);
      const res = await apiRequest("POST", "/api/scan-receipt", {
        imageBase64,
        mimeType: file.type || "image/jpeg",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Scan failed" }));
        throw new Error(err.error || "Scan failed");
      }
      const data: ReceiptData = await res.json();
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
    onResult({ merchant, total, date }, reviewFile);
    setReviewData(null);
    setReviewFile(null);
  };

  const handleClose = () => {
    setReviewData(null);
    setReviewFile(null);
  };

  if (!isPremium) {
    return (
      <button
        type="button"
        onClick={onUpgrade}
        className="flex items-center gap-2 w-full rounded-lg border border-dashed border-amber-400/60 p-3 text-sm text-amber-600 hover:bg-amber-50/10 transition-colors"
      >
        <Camera className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">AI scan · splits every item for you</span>
        <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
          <Crown className="w-3 h-3" /> Premium
        </span>
      </button>
    );
  }

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
        <span>{isScanning ? "Scanning receipt…" : "AI scan · splits every item for you"}</span>
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
            onItemSplit(splits);
            setReviewData(null);
            setReviewFile(null);
          } : undefined}
          onClose={handleClose}
        />
      )}
    </>
  );
}
