import { useRef, useState } from "react";
import { Camera, Crown, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ScanResult {
  merchant: string;
  total: number | null;
}

interface ScanReceiptButtonProps {
  isPremium: boolean;
  onUpgrade: () => void;
  /** Called with extracted data and the original File (for attaching to expense) */
  onResult: (data: ScanResult, file: File) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g. "data:image/jpeg;base64,")
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ScanReceiptButton({ isPremium, onUpgrade, onResult }: ScanReceiptButtonProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isScanning, setIsScanning] = useState(false);
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
      const data = await res.json();
      onResult({ merchant: data.merchant, total: data.total }, file);
      toast({
        title: "Receipt scanned!",
        description: data.total
          ? `${data.merchant} — $${Number(data.total).toFixed(2)}`
          : data.merchant,
      });
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setIsScanning(false);
      // Reset so the same file can be re-selected if needed
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (!isPremium) {
    return (
      <button
        type="button"
        onClick={onUpgrade}
        className="flex items-center gap-2 w-full rounded-lg border border-dashed border-amber-400/60 p-3 text-sm text-amber-600 hover:bg-amber-50/10 transition-colors"
      >
        <Camera className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">Scan receipt with AI</span>
        <span className="flex items-center gap-1 text-xs font-semibold text-amber-500">
          <Crown className="w-3 h-3" /> Premium
        </span>
      </button>
    );
  }

  return (
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
      <span>{isScanning ? "Scanning receipt…" : "Scan receipt with AI"}</span>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={isScanning}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
    </label>
  );
}
