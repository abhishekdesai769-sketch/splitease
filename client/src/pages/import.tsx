import { useState, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, CheckCircle, AlertCircle, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

interface PreviewExpense {
  date: string;
  description: string;
  amount: number;
  category: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export default function Import() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewExpense[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (!selected.name.endsWith(".csv")) {
      setError("Please select a CSV file exported from Splitwise.");
      return;
    }

    setFile(selected);
    setError(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const lines = text.split("\n").filter((l) => l.trim());
        if (lines.length < 2) {
          setError("CSV file appears to be empty.");
          return;
        }

        const headers = parseCSVLine(lines[0]);
        const dateIdx = headers.indexOf("Date");
        const descIdx = headers.indexOf("Description");
        const costIdx = headers.indexOf("Cost");
        const catIdx = headers.indexOf("Category");

        if (dateIdx === -1 || descIdx === -1 || costIdx === -1) {
          setError("CSV doesn't look like a Splitwise export. Expected columns: Date, Description, Cost.");
          return;
        }

        const expenses: PreviewExpense[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          const amount = parseFloat(cols[costIdx]);
          if (isNaN(amount) || amount <= 0) continue;

          expenses.push({
            date: cols[dateIdx] || "",
            description: cols[descIdx] || "",
            amount,
            category: catIdx !== -1 ? cols[catIdx] || "" : "",
          });
        }

        setPreview(expenses);
      } catch {
        setError("Failed to parse CSV file.");
      }
    };
    reader.readAsText(selected);
  };

  const handleImport = async () => {
    if (!file) return;

    setImporting(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/import/splitwise", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Import failed");
        return;
      }

      setResult({
        imported: data.imported,
        skipped: data.skipped,
        errors: data.errors || [],
      });
      setPreview([]);
      setFile(null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-4 pb-24 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setLocation("/expenses")} className="text-gray-400 hover:text-white">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-semibold text-white">Import from Splitwise</h1>
      </div>

      <Card className="bg-gray-800/50 border-gray-700 p-4 mb-4">
        <h3 className="text-sm font-medium text-teal-400 mb-2">How to export from Splitwise:</h3>
        <ol className="text-sm text-gray-400 space-y-1 list-decimal list-inside">
          <li>Open Splitwise and go to a group</li>
          <li>Click the gear icon, then Export as CSV</li>
          <li>Save the CSV file</li>
          <li>Upload it here</li>
        </ol>
        <p className="text-xs text-gray-500 mt-2">
          Note: Expenses will be imported with you as the payer. You can edit them after import.
        </p>
      </Card>

      <Card className="bg-gray-800/50 border-gray-700 p-6 mb-4">
        <div
          className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-teal-500 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
          {file ? (
            <div className="flex flex-col items-center gap-2">
              <FileText size={32} className="text-teal-400" />
              <p className="text-white font-medium">{file.name}</p>
              <p className="text-gray-400 text-sm">{preview.length} expenses found</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={32} className="text-gray-500" />
              <p className="text-gray-400">Tap to select your Splitwise CSV</p>
              <p className="text-gray-600 text-xs">CSV files only</p>
            </div>
          )}
        </div>
      </Card>

      {error && (
        <Card className="bg-red-900/20 border-red-800 p-4 mb-4">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        </Card>
      )}

      {result && (
        <Card className="bg-green-900/20 border-green-800 p-4 mb-4">
          <div className="flex items-start gap-2">
            <CheckCircle size={16} className="text-green-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-green-400 font-medium">
                Successfully imported {result.imported} expenses!
              </p>
              {result.skipped > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {result.skipped} rows skipped (settlements or zero amounts)
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {preview.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-300 mb-2">
            Preview ({preview.length} expenses)
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {preview.slice(0, 20).map((exp, i) => (
              <Card key={i} className="bg-gray-800/50 border-gray-700 p-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm text-white">{exp.description}</p>
                    <p className="text-xs text-gray-400">
                      {exp.date} {exp.category ? ` · ${exp.category}` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-teal-400">
                    ${exp.amount.toFixed(2)}
                  </p>
                </div>
              </Card>
            ))}
            {preview.length > 20 && (
              <p className="text-xs text-gray-500 text-center">
                ...and {preview.length - 20} more
              </p>
            )}
          </div>

          <Button
            onClick={handleImport}
            disabled={importing}
            className="w-full mt-4 bg-teal-600 hover:bg-teal-700 text-white"
          >
            {importing ? "Importing..." : `Import ${preview.length} Expenses`}
          </Button>
        </div>
      )}
    </div>
  );
}
