import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, CheckCircle, AlertCircle, ArrowLeft, Users2, UserPlus, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { Link } from "wouter";
import type { Group } from "@shared/schema";

interface PreviewExpense {
  date: string;
  description: string;
  amount: number;
  payer: string;
  splitAmong: string[];
  isSettlement: boolean;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  groupId?: string;
  groupName?: string;
  ghostMembers?: { id: string; name: string }[];
}

export default function Import() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewExpense[]>([]);
  const [personNames, setPersonNames] = useState<string[]>([]);
  const [matchedName, setMatchedName] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetGroupId, setTargetGroupId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch existing groups for re-import option
  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/groups"] });

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
        const currIdx = headers.indexOf("Currency");

        if (dateIdx === -1 || descIdx === -1 || costIdx === -1 || currIdx === -1) {
          setError("CSV doesn't look like a Splitwise export. Expected columns: Date, Description, Cost, Currency.");
          return;
        }

        // Extract person names from columns after Currency
        const names = headers.slice(currIdx + 1).map(n => n.trim()).filter(n => n);
        setPersonNames(names);

        // Try to match the current user
        const userName = (user?.name || "").toLowerCase().trim();
        let matched = names.find(n => n.toLowerCase() === userName);
        if (!matched) matched = names.find(n => n.toLowerCase().includes(userName) || userName.includes(n.toLowerCase()));
        if (!matched) {
          const firstName = userName.split(" ")[0];
          matched = names.find(n => n.toLowerCase().split(" ")[0] === firstName);
        }
        setMatchedName(matched || "");

        const catIdx = headers.indexOf("Category");
        const personColStart = currIdx + 1;

        const expenses: PreviewExpense[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          const description = (cols[descIdx] || "").trim();
          const cost = parseFloat(cols[costIdx]);
          if (!description || isNaN(cost) || cost === 0) continue;
          if (description.toLowerCase().includes("total balance")) continue;

          const category = catIdx !== -1 ? (cols[catIdx] || "").trim() : "";
          const isSettlement = category.toLowerCase() === "payment" || /^.+ paid .+$/i.test(description);

          // Find payer and split
          let payer = "";
          const splitAmong: string[] = [];
          for (let j = 0; j < names.length; j++) {
            const val = parseFloat(cols[personColStart + j]);
            if (!isNaN(val) && val !== 0) {
              splitAmong.push(names[j]);
              if (val > 0 && (!payer || val > parseFloat(cols[personColStart + names.indexOf(payer)]))) {
                payer = names[j];
              }
            }
          }

          expenses.push({
            date: cols[dateIdx] || "",
            description,
            amount: Math.abs(cost),
            payer: payer || "Unknown",
            splitAmong,
            isSettlement,
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
      if (targetGroupId) {
        formData.append("groupId", targetGroupId);
      }

      const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
      const res = await fetch(`${API_BASE}/api/import/splitwise`, {
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
        groupId: data.groupId,
        groupName: data.groupName,
        ghostMembers: data.ghostMembers || [],
      });
      setPreview([]);
      setFile(null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  const settlements = preview.filter(e => e.isSettlement);
  const regularExpenses = preview.filter(e => !e.isSettlement);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => setLocation("/expenses")} className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-semibold tracking-tight">Import from Splitwise</h1>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-medium text-primary mb-2">How to export from Splitwise:</h3>
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Open Splitwise and go to a group</li>
          <li>Tap the gear icon, then Export as CSV</li>
          <li>Save the CSV file</li>
          <li>Upload it here</li>
        </ol>
        <p className="text-xs text-muted-foreground mt-2">
          A new group will be created, or you can update an existing group with new expenses.
        </p>
      </Card>

      {/* Group selector: new or existing */}
      {groups.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium">Import into</h3>
          </div>
          <Select value={targetGroupId || "new"} onValueChange={(v) => setTargetGroupId(v === "new" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="New group (default)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New group</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name} (update)</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {targetGroupId && targetGroupId !== "new" && (
            <p className="text-xs text-muted-foreground mt-2">
              Only new expenses will be added. Duplicates (same date + amount + description) will be skipped.
            </p>
          )}
        </Card>
      )}

      {/* File upload */}
      <Card className="p-6">
        <div
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileSelect} className="hidden" />
          {file ? (
            <div className="flex flex-col items-center gap-2">
              <FileText size={32} className="text-primary" />
              <p className="font-medium">{file.name}</p>
              <p className="text-muted-foreground text-sm">{preview.length} expenses found</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={32} className="text-muted-foreground" />
              <p className="text-muted-foreground">Tap to select your Splitwise CSV</p>
              <p className="text-xs text-muted-foreground">CSV files only</p>
            </div>
          )}
        </div>
      </Card>

      {/* Detected people */}
      {personNames.length > 0 && !result && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users2 className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium">People in CSV ({personNames.length})</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {personNames.map((name) => (
              <span
                key={name}
                className={`text-xs px-2 py-1 rounded-full border ${
                  name === matchedName
                    ? "bg-primary/15 text-primary border-primary/30 font-medium"
                    : "bg-muted/50 text-muted-foreground border-border"
                }`}
              >
                {name === matchedName ? `${name} (You)` : name}
              </span>
            ))}
          </div>
          {!matchedName && (
            <p className="text-xs text-destructive mt-2">
              Could not match your name. Please make sure your Spliiit display name matches one of the names above.
            </p>
          )}
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        </Card>
      )}

      {/* Success result */}
      {result && (
        <div className="space-y-3">
          <Card className="p-4 border-primary/30 bg-primary/5">
            <div className="flex items-start gap-2">
              <CheckCircle size={16} className="text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-primary font-medium">
                  {(result as any).isUpdate
                    ? `Updated group with ${result.imported} new expenses!`
                    : `Successfully imported ${result.imported} expenses!`
                  }
                </p>
                {result.skipped > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {result.skipped} rows skipped (zero amounts or summary rows)
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* Ghost members created */}
          {result.ghostMembers && result.ghostMembers.length > 0 && (
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <UserPlus className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-medium">Ghost Members Created</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                These people don't have Spliiit accounts yet. You can invite them from the group page.
              </p>
              <div className="flex flex-wrap gap-2">
                {result.ghostMembers.map((g) => (
                  <span key={g.id} className="text-xs px-2 py-1 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">
                    {g.name}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {/* Link to group */}
          {result.groupId && (
            <Link href={`/groups/${result.groupId}`}>
              <Button className="w-full">
                View Group: {result.groupName}
              </Button>
            </Link>
          )}
        </div>
      )}

      {/* Preview */}
      {preview.length > 0 && !result && (
        <div>
          <h3 className="text-sm font-medium mb-2">
            Preview: {regularExpenses.length} expenses, {settlements.length} settlements
          </h3>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {preview.slice(0, 25).map((exp, i) => (
              <Card key={i} className={`p-3 ${exp.isSettlement ? "border-amber-500/20" : ""}`}>
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {exp.isSettlement && <span className="text-amber-500 text-xs mr-1">[Settlement]</span>}
                      {exp.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {exp.date} · Paid by <span className={exp.payer === matchedName ? "text-primary font-medium" : ""}>{exp.payer === matchedName ? "You" : exp.payer}</span>
                      {" · Split: "}{exp.splitAmong.length} people
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-primary shrink-0 ml-2">
                    ${exp.amount.toFixed(2)}
                  </p>
                </div>
              </Card>
            ))}
            {preview.length > 25 && (
              <p className="text-xs text-muted-foreground text-center py-1">
                ...and {preview.length - 25} more
              </p>
            )}
          </div>

          <Button
            onClick={handleImport}
            disabled={importing || !matchedName}
            className="w-full mt-4"
          >
            {importing ? "Importing..." : `Import ${preview.length} Expenses`}
          </Button>
        </div>
      )}
    </div>
  );
}
