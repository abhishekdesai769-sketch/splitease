import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, apiFormRequest, queryClient } from "@/lib/queryClient";
import type { SafeUser, Expense } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2, Receipt, CheckCircle2, HandCoins, AlertTriangle, UserMinus, Camera, X, Mail, Loader2, FileText, Upload, MoreVertical, Download, Repeat, Crown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { UpgradePromptSheet } from "@/components/UpgradePromptSheet";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { calculateGroupBalances } from "@/lib/simplify";

export default function FriendDetail({ friendId }: { friendId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [settleUpOpen, setSettleUpOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidById, setPaidById] = useState("");
  const [splitType, setSplitType] = useState<"equal" | "they_pay" | "you_pay">("equal");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState<"monthly" | "weekly">("monthly");
  const [upgradeSheetOpen, setUpgradeSheetOpen] = useState(false);

  // Splitwise import state
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "map" | "preview">("upload");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importCsvNames, setImportCsvNames] = useState<string[]>([]);
  const [importImporterName, setImportImporterName] = useState("");
  const [importPreview, setImportPreview] = useState<{ date: string; description: string; cost: string }[]>([]);

  // Delete friend: 2-step confirmation
  const [deleteFriendStep, setDeleteFriendStep] = useState<0 | 1 | 2>(0); // 0=closed, 1=first confirm, 2=final warning

  // Delete expense confirmation
  const [deleteExpenseId, setDeleteExpenseId] = useState<string | null>(null);

  // Receipt detail dialog
  const [receiptExpenseId, setReceiptExpenseId] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  const handleViewReceipt = async (expenseId: string) => {
    setReceiptExpenseId(expenseId);
    setReceiptLoading(true);
    setReceiptData(null);
    try {
      const res = await apiRequest("GET", `/api/expenses/${expenseId}/receipt`);
      const data = await res.json();
      setReceiptData(data);
    } catch {
      setReceiptData(null);
    } finally {
      setReceiptLoading(false);
    }
  };

  const { data: friendsList = [] } = useQuery<SafeUser[]>({
    queryKey: ["/api/friends"],
  });

  const { data: directExpenses = [] } = useQuery<Expense[]>({
    queryKey: ["/api/friends/expenses"],
  });

  const friend = friendsList.find((f) => f.id === friendId);

  // Filter expenses to only those between the current user and this friend
  const friendExpenses = directExpenses.filter(
    (e) =>
      (e.paidById === user?.id && e.splitAmongIds.includes(friendId)) ||
      (e.paidById === friendId && e.splitAmongIds.includes(user?.id || ""))
  );

  const sortedExpenses = [...friendExpenses].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Calculate balance between just this user and this friend
  const friendBalances = calculateGroupBalances(friendExpenses);
  const myBalance = friendBalances.find((b) => b.personId === user?.id)?.amount || 0;

  const addExpenseMutation = useMutation({
    mutationFn: async () => {
      let actualPaidById = paidById;
      let splitAmongIds: string[];

      if (splitType === "equal") {
        splitAmongIds = [user?.id || "", friendId].filter((v, i, a) => a.indexOf(v) === i);
      } else if (splitType === "they_pay") {
        splitAmongIds = [friendId];
      } else {
        actualPaidById = friendId;
        splitAmongIds = [user?.id || ""];
      }

      const formData = new FormData();
      formData.append("description", description.trim());
      formData.append("amount", String(parseFloat(amount)));
      formData.append("paidById", actualPaidById);
      formData.append("splitAmongIds", JSON.stringify(splitAmongIds));
      formData.append("date", new Date().toISOString());
      if (receiptFile) {
        formData.append("receipt", receiptFile);
      }
      const res = await apiFormRequest("POST", "/api/friends/expenses", formData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      resetExpenseForm();
      setAddExpenseOpen(false);
      toast({ title: "Expense added" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const addRecurringMutation = useMutation({
    mutationFn: async () => {
      let actualPaidById = paidById;
      let splitAmongIds: string[];

      if (splitType === "equal") {
        splitAmongIds = [user?.id || "", friendId].filter((v, i, a) => a.indexOf(v) === i);
      } else if (splitType === "they_pay") {
        splitAmongIds = [friendId];
      } else {
        actualPaidById = friendId;
        splitAmongIds = [user?.id || ""];
      }

      const res = await apiRequest("POST", "/api/recurring", {
        description: description.trim(),
        amount: parseFloat(amount),
        paidById: actualPaidById,
        splitAmongIds,
        groupId: null,
        frequency: recurringFrequency,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring"] });
      resetExpenseForm();
      setAddExpenseOpen(false);
      toast({ title: "Recurring expense created", description: `First expense added. Repeats ${recurringFrequency}.` });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const settleUpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settle-up", {
        friendId: friendId,
        amount: Math.abs(myBalance),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setSettleUpOpen(false);
      toast({ title: "Settled up", description: "Payment recorded" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/expenses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setDeleteExpenseId(null);
      toast({ title: "Expense deleted" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
      setDeleteExpenseId(null);
    },
  });

  const exportFriendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/export/expenses", {
        scope: "friend",
        friendId,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Export sent", description: data.message || "CSV sent to your email" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const removeFriendMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/friends/${friendId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      setDeleteFriendStep(0);
      toast({ title: "Friend removed" });
      setLocation("/friends");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteAllExpensesMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/friends/${friendId}/expenses`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/friends", friendId] });
      toast({ title: "All expenses deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const importFriendMutation = useMutation({
    mutationFn: async () => {
      if (!importFile || !importImporterName) return;
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("importerName", importImporterName);
      const res = await fetch(`/api/friends/${friendId}/import-splitwise`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Import failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/friends/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setImportOpen(false);
      setImportStep("upload");
      setImportFile(null);
      setImportImporterName("");
      setImportPreview([]);
      toast({
        title: "Import complete",
        description: `${data.imported} expenses imported${data.skipped > 0 ? `, ${data.skipped} skipped` : ""}.`,
      });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    },
  });

  const resetExpenseForm = () => {
    setDescription("");
    setAmount("");
    setPaidById("");
    setSplitType("equal");
    setReceiptFile(null);
    setIsRecurring(false);
    setRecurringFrequency("monthly");
  };

  // Can the current user delete this expense?
  const canDeleteExpense = (expense: Expense) => {
    return expense.addedById === user?.id || user?.isAdmin;
  };

  if (!friend) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 bg-muted animate-pulse rounded" />
        <div className="h-20 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/friends">
          <Button size="icon" variant="ghost" data-testid="back-to-friends">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
          style={{ backgroundColor: friend.avatarColor }}
        >
          {friend.name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight truncate font-serif"><em className="italic text-accent-foreground">{friend.name}</em></h1>
          <p className="text-sm text-muted-foreground truncate">{friend.email}</p>
        </div>
        {/* ⋮ Three-dot menu: Import + Remove Friend */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" data-testid="friend-detail-more-btn">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => setImportOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Import from another app
            </DropdownMenuItem>
            {friendExpenses.length > 0 && (
              <DropdownMenuItem onClick={() => exportFriendMutation.mutate()} disabled={exportFriendMutation.isPending}>
                <Download className="w-4 h-4 mr-2" />
                Export expenses
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {friendExpenses.length > 0 && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  if (confirm(`Delete all ${friendExpenses.length} expenses with ${friend.name}? This cannot be undone.`)) {
                    deleteAllExpensesMutation.mutate();
                  }
                }}
                disabled={deleteAllExpensesMutation.isPending}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete All Expenses
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteFriendStep(1)}
            >
              <UserMinus className="w-4 h-4 mr-2" />
              Remove Friend
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Import Dialog (triggered from ⋮ menu) */}
        <Dialog open={importOpen} onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) { setImportStep("upload"); setImportFile(null); setImportImporterName(""); setImportPreview([]); }
        }}>
          <DialogTrigger className="hidden" />
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Import from Splitwise</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {importStep === "upload" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Export your Splitwise history with <span className="font-medium text-foreground">{friend.name}</span> as a CSV, then upload it here.
                  </p>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside bg-muted/40 rounded-lg p-3">
                    <li>In Splitwise, open your friend or group with {friend.name}</li>
                    <li>Tap the settings / export icon and choose "Export to CSV"</li>
                    <li>Upload that CSV file below</li>
                  </ol>
                  <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 p-6 cursor-pointer hover:bg-muted/40 transition-colors">
                    <Upload className="w-8 h-8 text-muted-foreground" />
                    {importFile ? (
                      <p className="text-sm font-medium text-foreground">{importFile.name}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Tap to select CSV file</p>
                    )}
                    <input type="file" accept=".csv" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0]; if (f) setImportFile(f);
                    }} />
                  </label>
                  <Button className="w-full" disabled={!importFile || importLoading} onClick={async () => {
                    if (!importFile) return;
                    setImportLoading(true);
                    try {
                      const text = await importFile.text();
                      const allLines = text.split(/\r?\n/).filter(l => l.trim());
                      if (allLines.length < 2) { toast({ title: "Error", description: "CSV is empty", variant: "destructive" }); return; }
                      // Friends CSV starts with a "Note:" line — find the real header row by locating "Currency"
                      const headerIdx = allLines.findIndex(l =>
                        l.split(",").some(h => h.replace(/^"|"$/g, "").trim().toLowerCase() === "currency")
                      );
                      if (headerIdx === -1) { toast({ title: "Error", description: "Invalid Splitwise CSV — missing Currency column", variant: "destructive" }); return; }
                      const lines = allLines.slice(headerIdx); // lines[0] = header, lines[1+] = data
                      const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
                      const currIdx = headers.findIndex(h => h.toLowerCase() === "currency");
                      const csvNames = headers.slice(currIdx + 1).map(n => n.trim()).filter(n => n);
                      if (csvNames.length < 2) { toast({ title: "Error", description: "CSV must have at least 2 person columns", variant: "destructive" }); return; }
                      // Build preview
                      const dateIdx = headers.findIndex(h => h.toLowerCase() === "date");
                      const descIdx = headers.findIndex(h => h.toLowerCase() === "description");
                      const costIdx = headers.findIndex(h => h.toLowerCase() === "cost");
                      const preview = lines.slice(1).map(line => {
                        const cols = line.split(",").map(c => c.replace(/^"|"$/g, "").trim());
                        return { date: cols[dateIdx] || "", description: cols[descIdx] || "", cost: cols[costIdx] || "0" };
                      }).filter(r => r.description && !r.description.toLowerCase().includes("total balance"));
                      setImportCsvNames(csvNames);
                      setImportPreview(preview);
                      // Auto-detect importer column: match against current user's name
                      const userName = user?.name?.toLowerCase() || "";
                      const autoMatch = csvNames.find(n => n.toLowerCase() === userName || userName.includes(n.toLowerCase()) || n.toLowerCase().includes(userName));
                      if (autoMatch) setImportImporterName(autoMatch);
                      setImportStep("map");
                    } catch {
                      toast({ title: "Error", description: "Failed to parse CSV", variant: "destructive" });
                    } finally {
                      setImportLoading(false);
                    }
                  }}>
                    {importLoading ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Parsing...</> : "Continue"}
                  </Button>
                </>
              )}

              {importStep === "map" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Which column in the CSV is <span className="font-medium text-foreground">you</span>? The other column(s) will be mapped to <span className="font-medium text-foreground">{friend.name}</span>.
                  </p>
                  <div className="space-y-2">
                    <p className="text-xs font-medium">Your name in the CSV</p>
                    <Select value={importImporterName} onValueChange={setImportImporterName}>
                      <SelectTrigger><SelectValue placeholder="Select your column..." /></SelectTrigger>
                      <SelectContent>
                        {importCsvNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {importImporterName && (
                    <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground space-y-1">
                      <p>✓ <span className="text-foreground font-medium">{importImporterName}</span> → You</p>
                      {importCsvNames.filter(n => n !== importImporterName).map(n => (
                        <p key={n}>✓ <span className="text-foreground font-medium">{n}</span> → {friend.name}</p>
                      ))}
                      <p className="pt-1 border-t border-border mt-1">{importPreview.length} expenses found in CSV</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setImportStep("upload")}>Back</Button>
                    <Button
                      className="flex-1"
                      disabled={!importImporterName || importFriendMutation.isPending}
                      onClick={() => importFriendMutation.mutate()}
                    >
                      {importFriendMutation.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Importing...</> : `Import ${importPreview.length} expenses`}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={addExpenseOpen} onOpenChange={setAddExpenseOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="add-friend-expense-btn">
              <Plus className="w-4 h-4 mr-1.5" />
              Expense
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Split with {friend.name}</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (description.trim() && amount && paidById) {
                  if (isRecurring) {
                    addRecurringMutation.mutate();
                  } else {
                    addExpenseMutation.mutate();
                  }
                }
              }}
            >
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  placeholder="e.g. Coffee, Uber ride"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  data-testid="input-friend-detail-desc"
                />
              </div>
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  data-testid="input-friend-detail-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>Paid by</Label>
                <Select value={paidById} onValueChange={setPaidById}>
                  <SelectTrigger data-testid="select-friend-detail-paid-by">
                    <SelectValue placeholder="Who paid?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={user?.id || "me"}>
                      {user?.name} (You)
                    </SelectItem>
                    <SelectItem value={friendId}>
                      {friend.name}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Split type toggle */}
              <div className="space-y-2">
                <Label>How to split</Label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["equal", "they_pay", "you_pay"] as const).map((type) => {
                    const labels = {
                      equal: "Split equally",
                      they_pay: "They pay you",
                      you_pay: "You pay them",
                    };
                    return (
                      <button
                        key={type}
                        type="button"
                        className={`px-2 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                          splitType === type
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                        onClick={() => setSplitType(type)}
                        data-testid={`friend-detail-split-type-${type}`}
                      >
                        {labels[type]}
                      </button>
                    );
                  })}
                </div>
              </div>
              {amount && paidById && (
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  {splitType === "equal" ? (
                    <p className="text-sm text-muted-foreground">
                      Split equally — <span className="font-medium text-foreground">${(parseFloat(amount) / 2).toFixed(2)}</span> each
                    </p>
                  ) : splitType === "they_pay" ? (
                    <p className="text-sm text-muted-foreground">
                      {paidById === user?.id
                        ? <>{friend.name} pays you <span className="font-semibold text-primary">${parseFloat(amount).toFixed(2)}</span></>
                        : <>You pay {friend.name} <span className="font-semibold text-destructive">${parseFloat(amount).toFixed(2)}</span></>
                      }
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {paidById === user?.id
                        ? <>You pay {friend.name} <span className="font-semibold text-destructive">${parseFloat(amount).toFixed(2)}</span></>
                        : <>{friend.name} pays you <span className="font-semibold text-primary">${parseFloat(amount).toFixed(2)}</span></>
                      }
                    </p>
                  )}
                </div>
              )}
              {/* Repeat toggle (Premium) */}
              <div className="rounded-lg border border-border p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Repeat className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium leading-tight">Repeat this expense</p>
                      <p className="text-xs text-muted-foreground">Auto-creates on schedule</p>
                    </div>
                  </div>
                  {user?.isPremium ? (
                    <Switch checked={isRecurring} onCheckedChange={setIsRecurring} />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setUpgradeSheetOpen(true)}
                      className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
                    >
                      <Crown className="w-3 h-3" /> Premium
                    </button>
                  )}
                </div>
                {isRecurring && user?.isPremium && (
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    {(["monthly", "weekly"] as const).map((freq) => (
                      <button
                        key={freq}
                        type="button"
                        className={`py-2 rounded-lg border text-xs font-medium transition-colors ${
                          recurringFrequency === freq
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                        onClick={() => setRecurringFrequency(freq)}
                      >
                        {freq === "monthly" ? "Monthly" : "Weekly"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <UpgradePromptSheet open={upgradeSheetOpen} onClose={() => setUpgradeSheetOpen(false)} />

              {/* Receipt upload (simple attach — photo is emailed to all participants) */}
              {!isRecurring && (
              <div className="space-y-2">
                <Label>Receipt (optional)</Label>
                {receiptFile ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border p-2.5">
                    <Camera className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm truncate flex-1">{receiptFile.name}</span>
                    <button type="button" className="text-muted-foreground hover:text-foreground"
                      onClick={() => setReceiptFile(null)}
                    ><X className="w-4 h-4" /></button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                    <Camera className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Attach receipt photo</span>
                    <input type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) setReceiptFile(f); }}
                      data-testid="input-friend-receipt"
                    />
                  </label>
                )}
                <p className="text-xs text-muted-foreground">Photo will be sent via email to everyone in the split.</p>
              </div>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={
                  !description.trim() ||
                  !amount ||
                  !paidById ||
                  addExpenseMutation.isPending ||
                  addRecurringMutation.isPending
                }
                data-testid="submit-friend-detail-expense"
              >
                {(addExpenseMutation.isPending || addRecurringMutation.isPending)
                  ? "Adding..."
                  : isRecurring && user?.isPremium
                    ? `Set Up Recurring (${recurringFrequency})`
                    : "Add Expense"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Balance summary */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Balance</p>
            {myBalance === 0 ? (
              <p className="text-lg font-semibold text-muted-foreground">All settled up</p>
            ) : myBalance > 0 ? (
              <p className="text-lg font-semibold text-primary font-mono">
                {friend.name} pays you ${myBalance.toFixed(2)}
              </p>
            ) : (
              <p className="text-lg font-semibold text-destructive font-mono">
                You pay {friend.name} ${Math.abs(myBalance).toFixed(2)}
              </p>
            )}
          </div>
          {myBalance !== 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettleUpOpen(true)}
              data-testid="friend-detail-settle-up"
            >
              <HandCoins className="w-4 h-4 mr-1.5" />
              Settle Up
            </Button>
          )}
        </div>
      </Card>

      {/* Settle Up Dialog */}
      <Dialog open={settleUpOpen} onOpenChange={setSettleUpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settle Up</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-muted/50 p-4 text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                {myBalance < 0 ? (
                  <>You pay <span className="font-semibold text-foreground">{friend.name}</span></>
                ) : (
                  <><span className="font-semibold text-foreground">{friend.name}</span> pays you</>
                )}
              </p>
              <p className="text-2xl font-bold text-primary">
                ${Math.abs(myBalance).toFixed(2)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              This will record a payment that zeros out your balance with {friend.name}.
            </p>
            <Button
              className="w-full"
              onClick={() => settleUpMutation.mutate()}
              disabled={settleUpMutation.isPending}
              data-testid="confirm-friend-detail-settle-up"
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              {settleUpMutation.isPending ? "Settling..." : "Confirm Settlement"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Receipt detail dialog */}
      <Dialog open={!!receiptExpenseId} onOpenChange={(open) => { if (!open) { setReceiptExpenseId(null); setReceiptData(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              {receiptData?.merchant || "Receipt Details"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            {receiptLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground ml-2">Loading receipt...</span>
              </div>
            ) : receiptData ? (
              <>
                {receiptData.items?.length > 0 && (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody>
                        {receiptData.items.map((item: any, i: number) => (
                          <tr key={i} className={i % 2 === 0 ? "bg-muted/30" : ""}>
                            <td className="px-3 py-2 text-foreground">{item.name}</td>
                            <td className="px-3 py-2 text-right font-medium text-foreground whitespace-nowrap">
                              ${typeof item.price === "number" ? item.price.toFixed(2) : item.price}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="border-t border-border px-3 py-2 space-y-1">
                      {receiptData.subtotal != null && (
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Subtotal</span>
                          <span>${receiptData.subtotal.toFixed(2)}</span>
                        </div>
                      )}
                      {receiptData.tax != null && (
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Tax</span>
                          <span>${receiptData.tax.toFixed(2)}</span>
                        </div>
                      )}
                      {receiptData.total != null && (
                        <div className="flex justify-between text-sm font-semibold text-foreground pt-1 border-t border-border">
                          <span>Total</span>
                          <span>${receiptData.total.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {(!receiptData.items || receiptData.items.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">No items extracted from this receipt.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No receipt data available.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Expense Confirmation Dialog */}
      <Dialog open={!!deleteExpenseId} onOpenChange={(open) => { if (!open) setDeleteExpenseId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-3 rounded-lg bg-destructive/10 p-4">
              <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
              <p className="text-sm text-foreground">
                Are you sure you want to delete this expense? This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setDeleteExpenseId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  if (deleteExpenseId) deleteExpenseMutation.mutate(deleteExpenseId);
                }}
                disabled={deleteExpenseMutation.isPending}
                data-testid="confirm-delete-expense"
              >
                {deleteExpenseMutation.isPending ? "Deleting..." : "Yes, Delete"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Friend 2-step Confirmation Dialog */}
      <Dialog open={deleteFriendStep > 0} onOpenChange={(open) => { if (!open) setDeleteFriendStep(0); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteFriendStep === 1 ? "Remove Friend" : "Final Warning"}
            </DialogTitle>
          </DialogHeader>
          {deleteFriendStep === 1 && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-3 rounded-lg bg-destructive/10 p-4">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                <p className="text-sm text-foreground">
                  Are you sure you want to remove <strong>{friend.name}</strong> from your friends?
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setDeleteFriendStep(0)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => setDeleteFriendStep(2)}
                >
                  Yes, Remove
                </Button>
              </div>
            </div>
          )}
          {deleteFriendStep === 2 && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg bg-destructive/10 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                  <p className="text-sm font-semibold text-destructive">This is permanent</p>
                </div>
                <p className="text-sm text-foreground">
                  If you remove <strong>{friend.name}</strong>, all expense history between you two will also be deleted. This cannot be undone.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setDeleteFriendStep(0)}
                >
                  No, keep friend
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => removeFriendMutation.mutate()}
                  disabled={removeFriendMutation.isPending}
                  data-testid="confirm-delete-friend-final"
                >
                  {removeFriendMutation.isPending ? "Removing..." : "I understand, delete"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Expenses list */}
      {sortedExpenses.length > 0 ? (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-2 font-serif">
            Expenses with {friend.name}
          </h2>
          <div className="space-y-2">
            {sortedExpenses.map((expense) => {
              const paidByName = expense.paidById === user?.id ? "You" : friend.name;
              return (
                <Card
                  key={expense.id}
                  className={`p-3 ${expense.isSettlement ? "border-primary/30 bg-primary/5" : ""}`}
                  data-testid={`friend-expense-${expense.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${expense.isSettlement ? "bg-primary/20" : "bg-primary/10"}`}>
                      {expense.isSettlement ? (
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                      ) : (
                        <Receipt className="w-4 h-4 text-primary" />
                      )}
                    </div>
                    <div
                      className={`flex-1 min-w-0 ${(expense as any).receiptData ? "cursor-pointer" : ""}`}
                      onClick={() => { if ((expense as any).receiptData) handleViewReceipt(expense.id); }}
                    >
                      <p className="text-sm font-medium truncate">
                        {expense.isSettlement ? "Settlement" : expense.description}
                        {(expense as any).receiptData && (
                          <FileText className="w-3 h-3 text-primary inline ml-1 -mt-0.5" />
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {paidByName} paid · {new Date(expense.date).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-foreground shrink-0 font-mono">
                      ${expense.amount.toFixed(2)}
                    </span>
                    {canDeleteExpense(expense) && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteExpenseId(expense.id)}
                        data-testid={`delete-expense-${expense.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Receipt className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold mb-1">No expenses yet</h3>
          <p className="text-sm text-muted-foreground">
            Add an expense to start tracking splits with {friend.name}.
          </p>
        </Card>
      )}

    </div>
  );
}
