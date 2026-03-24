import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, apiFormRequest, queryClient } from "@/lib/queryClient";
import type { Group, Expense, SafeUser } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, ArrowLeft, Trash2, Shuffle, Receipt, UserPlus, X, HandCoins, CheckCircle2, AlertTriangle, Camera, Mail, Loader2, Crown, Shield, LogOut, UserMinus, Clock, Check, Ghost, FileText, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { calculateGroupBalances, simplifyDebts } from "@/lib/simplify";
import { ocrReceipt, parseReceiptText, type ReceiptData as ParsedReceiptData } from "@/lib/receipt-ocr";

export default function GroupDetail({ groupId }: { groupId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [showSimplified, setShowSimplified] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidById, setPaidById] = useState("");
  const [splitAmong, setSplitAmong] = useState<string[]>([]);
  const [groupSplitType, setGroupSplitType] = useState<"equal" | "they_pay" | "you_pay">("equal");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [settleUpOpen, setSettleUpOpen] = useState(false);
  const [settlePayerId, setSettlePayerId] = useState("");
  const [settleReceiverId, setSettleReceiverId] = useState("");
  const [settleAmount, setSettleAmount] = useState("");

  // Delete expense confirmation
  const [deleteExpenseId, setDeleteExpenseId] = useState<string | null>(null);

  // Receipt detail dialog
  const [receiptExpenseId, setReceiptExpenseId] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  // Receipt scanning confirmation flow (free tier — Tesseract)
  const [receiptScanning, setReceiptScanning] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<any>(null);
  const [receiptRawText, setReceiptRawText] = useState("");
  const [receiptConfirmStep, setReceiptConfirmStep] = useState<"preview" | "edit" | "options" | null>(null);
  const [editItems, setEditItems] = useState<{ name: string; price: string }[]>([]);

  // Delete group: 2-step confirmation
  const [deleteGroupStep, setDeleteGroupStep] = useState<0 | 1 | 2>(0);

  // Group rename
  const [renaming, setRenaming] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // Member action dialog state
  const [memberActionMember, setMemberActionMember] = useState<SafeUser | null>(null);

  // Ghost invite dialog state
  const [ghostInviteMember, setGhostInviteMember] = useState<SafeUser | null>(null);
  const [ghostInviteEmail, setGhostInviteEmail] = useState("");
  const [ghostInviting, setGhostInviting] = useState(false);

  const [, setLocation] = useLocation();

  const { data: group } = useQuery<Group>({ queryKey: ["/api/groups", groupId] });
  const { data: members = [] } = useQuery<SafeUser[]>({
    queryKey: ["/api/groups", groupId, "members"],
    enabled: !!group,
  });
  const { data: expenses = [] } = useQuery<Expense[]>({
    queryKey: ["/api/expenses/group", groupId],
  });

  const createExpenseMutation = useMutation({
    mutationFn: async () => {
      let actualPaidById = paidById;
      let splitAmongIds: string[];

      if (groupSplitType === "equal") {
        // Split equally among all selected (payer can be included if checked)
        splitAmongIds = splitAmong;
      } else if (groupSplitType === "they_pay") {
        // Selected people each owe their share of full amount back to the payer
        // Payer is NOT in the split — only the selected people
        splitAmongIds = splitAmong.filter(id => id !== paidById);
      } else {
        // "You pay them" — the payer needs to pay the selected people
        // Flip: one of the selected people is treated as the lender
        // Only the payer is in the split (they owe the full amount)
        splitAmongIds = [paidById];
        // The "paid by" becomes the first selected non-payer member
        const lender = splitAmong.find(id => id !== paidById);
        if (lender) actualPaidById = lender;
      }

      if (splitAmongIds.length === 0) splitAmongIds = splitAmong;

      const formData = new FormData();
      formData.append("description", description.trim());
      formData.append("amount", String(parseFloat(amount)));
      formData.append("paidById", actualPaidById);
      formData.append("splitAmongIds", JSON.stringify(splitAmongIds));
      formData.append("groupId", groupId);
      formData.append("date", new Date().toISOString());
      if (receiptFile) {
        formData.append("receipt", receiptFile);
      }
      // Include scanned receipt data if confirmed by user
      if (receiptPreview && receiptPreview.items?.length > 0) {
        formData.append("receiptData", JSON.stringify(receiptPreview));
      }

      const res = await apiFormRequest("POST", "/api/expenses", formData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      resetForm();
      setAddOpen(false);
      toast({ title: "Expense added" });
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
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setDeleteExpenseId(null);
      toast({ title: "Expense removed" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
      setDeleteExpenseId(null);
    },
  });

  // Can the current user delete this expense?
  const canDeleteExpense = (expense: Expense) => {
    return expense.addedById === user?.id || user?.isAdmin;
  };

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/groups/${groupId}/invite`, {
        email: inviteEmail.trim().toLowerCase(),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "invites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setInviteEmail("");
      setInviteOpen(false);
      const isAdminSender = data.adminApproved;
      toast({
        title: "Invite sent",
        description: isAdminSender
          ? "Invite sent! Waiting for them to accept."
          : "Invite sent! Waiting for approval.",
      });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

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

  const handleGhostInvite = async () => {
    if (!ghostInviteMember || !ghostInviteEmail.trim()) return;
    setGhostInviting(true);
    try {
      const res = await apiRequest("POST", `/api/ghost/${ghostInviteMember.id}/invite`, {
        email: ghostInviteEmail.trim().toLowerCase(),
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setGhostInviteMember(null);
      setGhostInviteEmail("");
      if (data.merged) {
        toast({ title: "Merged!", description: `${ghostInviteMember.name} was linked to existing user ${data.userName}.` });
      } else {
        toast({ title: "Invite sent!", description: `Signup invite sent to ${data.email}.` });
      }
    } catch (err: any) {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setGhostInviting(false);
    }
  };

  // Pending invites for this group
  const { data: pendingInvites = [] } = useQuery<any[]>({
    queryKey: ["/api/groups", groupId, "invites"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/groups/${groupId}/invites`);
      return res.json();
    },
  });

  const approveInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await apiRequest("POST", `/api/invites/${inviteId}/admin-approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "invites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      toast({ title: "Invite approved" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const rejectInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const res = await apiRequest("POST", `/api/invites/${inviteId}/admin-reject`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "invites"] });
      toast({ title: "Invite rejected" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const groupSettleUpMutation = useMutation({
    mutationFn: async () => {
      // Create a settlement expense in this group
      // paidById = the person making the payment (settling their debt)
      // splitAmongIds = the person receiving the payment
      const res = await apiRequest("POST", "/api/expenses", {
        description: "Settlement payment",
        amount: parseFloat(settleAmount),
        paidById: settlePayerId,
        splitAmongIds: [settleReceiverId],
        groupId,
        date: new Date().toISOString(),
        isSettlement: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setSettleUpOpen(false);
      setSettlePayerId("");
      setSettleReceiverId("");
      setSettleAmount("");
      toast({ title: "Settled up", description: "Payment recorded in this group" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/groups/${groupId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      setDeleteGroupStep(0);
      toast({ title: "Group deleted" });
      setLocation("/groups");
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const exportGroupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/export/expenses", {
        scope: "group",
        groupId,
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

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      await apiRequest("DELETE", `/api/groups/${groupId}/members/${memberId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setMemberActionMember(null);
      toast({ title: "Member removed" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await apiRequest("POST", `/api/groups/${groupId}/promote/${memberId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setMemberActionMember(null);
      toast({ title: "Member promoted to Admin" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const demoteMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await apiRequest("POST", `/api/groups/${groupId}/demote/${memberId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setMemberActionMember(null);
      toast({ title: "Admin demoted to Member" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const leaveGroupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/groups/${groupId}/leave`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "members"] });
      toast({ title: "You left the group" });
      setLocation("/groups");
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Cannot leave group", description: msg, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setDescription("");
    setAmount("");
    setPaidById("");
    setSplitAmong([]);
    setGroupSplitType("equal");
    setReceiptFile(null);
    setReceiptPreview(null);
    setReceiptConfirmStep(null);
    setReceiptRawText("");
    setEditItems([]);
  };

  const toggleSplit = (id: string) => {
    setSplitAmong((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const selectAllMembers = () => {
    setSplitAmong(members.map((m) => m.id));
  };

  // Balance calculations
  const balances = calculateGroupBalances(expenses);
  const settlements = simplifyDebts(balances);
  const getPersonName = (id: string) => {
    if (id === user?.id) return "You";
    return members.find((m) => m.id === id)?.name || "Someone";
  };
  const getPersonColor = (id: string) => members.find((m) => m.id === id)?.avatarColor || "#666";

  // Role helpers
  const adminIds = group?.adminIds || [];
  const isMeOwner = group?.createdById === user?.id;
  const isMeAdmin = adminIds.includes(user?.id || "");
  const isMeGlobalAdmin = user?.isAdmin;

  const getMemberRole = (memberId: string): "owner" | "admin" | "member" => {
    if (memberId === group?.createdById) return "owner";
    if ((group?.adminIds || []).includes(memberId)) return "admin";
    return "member";
  };

  // Whether current user can perform actions on a given member
  const canActOnMember = (memberId: string): boolean => {
    if (!group) return false;
    if (memberId === user?.id) return false; // Can't act on yourself via member dialog
    return isMeOwner || isMeAdmin || !!isMeGlobalAdmin;
  };

  const totalGroupSpend = expenses.reduce((sum, e) => sum + e.amount, 0);

  if (!group) {
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
        <Link href="/groups">
          <Button size="icon" variant="ghost" data-testid="back-to-groups">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          {renaming ? (
            <form className="flex items-center gap-1" onSubmit={async (e) => {
              e.preventDefault();
              const trimmed = newGroupName.trim();
              if (!trimmed) { setRenaming(false); return; }
              try {
                await apiRequest("PATCH", `/api/groups/${groupId}/name`, { name: trimmed });
                queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
                queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
                toast({ title: "Group renamed" });
              } catch (err: any) {
                let msg = err.message;
                try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
                toast({ title: "Error", description: msg, variant: "destructive" });
              }
              setRenaming(false);
            }}>
              <Input
                autoFocus
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="h-8 text-lg font-semibold"
                onBlur={() => setRenaming(false)}
                onKeyDown={(e) => { if (e.key === "Escape") setRenaming(false); }}
              />
            </form>
          ) : (
            <h1
              className={`text-xl font-semibold tracking-tight truncate ${(isMeOwner || isMeAdmin || isMeGlobalAdmin) ? "cursor-pointer hover:text-primary transition-colors" : ""}`}
              onClick={() => {
                if (isMeOwner || isMeAdmin || isMeGlobalAdmin) {
                  setNewGroupName(group.name);
                  setRenaming(true);
                }
              }}
            >
              {group.name}
              {(isMeOwner || isMeAdmin || isMeGlobalAdmin) && (
                <Pencil className="w-3 h-3 inline ml-1.5 text-muted-foreground" />
              )}
            </h1>
          )}
          <p className="text-sm text-muted-foreground">
            {members.length} members · ${totalGroupSpend.toFixed(2)} total
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="add-expense-btn">
              <Plus className="w-4 h-4 mr-1.5" />
              Expense
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Expense</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (description.trim() && amount && paidById && splitAmong.length > 0) {
                  createExpenseMutation.mutate();
                }
              }}
            >
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  placeholder="e.g. Dinner at Joe's"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  data-testid="input-expense-desc"
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
                  data-testid="input-expense-amount"
                />
              </div>
              <div className="space-y-2">
                <Label>Paid by</Label>
                <Select value={paidById} onValueChange={setPaidById}>
                  <SelectTrigger data-testid="select-paid-by">
                    <SelectValue placeholder="Who paid?" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.id === user?.id ? `${m.name} (You)` : m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* How to split */}
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
                          groupSplitType === type
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:bg-muted/50"
                        }`}
                        onClick={() => setGroupSplitType(type)}
                        data-testid={`group-split-type-${type}`}
                      >
                        {labels[type]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>
                    {groupSplitType === "equal" ? "Split among" : groupSplitType === "they_pay" ? "Who pays you" : "You pay who"}
                  </Label>
                  <button
                    type="button"
                    className="text-xs text-primary font-medium"
                    onClick={selectAllMembers}
                  >
                    Select all
                  </button>
                </div>
                <div className="space-y-1.5">
                  {members.map((m) => {
                    // Calculate per-person amount for preview
                    const effectiveSplit = groupSplitType === "they_pay"
                      ? splitAmong.filter(id => id !== paidById)
                      : groupSplitType === "you_pay"
                        ? [paidById]
                        : splitAmong;
                    const perPerson = effectiveSplit.length > 0 && amount
                      ? parseFloat(amount) / effectiveSplit.length
                      : 0;
                    const showAmount = splitAmong.includes(m.id) && amount && splitAmong.length > 0;

                    return (
                      <label
                        key={m.id}
                        className="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          checked={splitAmong.includes(m.id)}
                          onCheckedChange={() => toggleSplit(m.id)}
                        />
                        <span className="text-sm">
                          {m.id === user?.id ? `${m.name} (You)` : m.name}
                        </span>
                        {showAmount && effectiveSplit.includes(m.id) && (
                          <span className="text-xs text-muted-foreground ml-auto">
                            ${perPerson.toFixed(2)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Preview summary */}
              {amount && paidById && splitAmong.length > 0 && groupSplitType !== "equal" && (
                <div className="rounded-lg bg-muted/50 p-3 text-center">
                  <p className="text-sm text-muted-foreground">
                    {groupSplitType === "they_pay" ? (
                      <>Selected members pay {paidById === user?.id ? "you" : getPersonName(paidById)} the full <span className="font-semibold text-primary">${parseFloat(amount).toFixed(2)}</span></>
                    ) : (
                      <>{paidById === user?.id ? "You" : getPersonName(paidById)} pay{paidById === user?.id ? "" : "s"} selected member <span className="font-semibold text-destructive">${parseFloat(amount).toFixed(2)}</span></>
                    )}
                  </p>
                </div>
              )}

              {/* Receipt upload + scanning */}
              <div className="space-y-2">
                <Label>Receipt (optional)</Label>
                {receiptFile && !receiptScanning && !receiptConfirmStep ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border p-2.5">
                    <Camera className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm truncate flex-1">{receiptFile.name}</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => { setReceiptFile(null); setReceiptPreview(null); setReceiptConfirmStep(null); }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : receiptScanning ? (
                  <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                    <span className="text-sm text-primary">Scanning receipt...</span>
                  </div>
                ) : !receiptFile ? (
                  <label className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                    <Camera className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Attach receipt photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setReceiptFile(file);
                        setReceiptScanning(true);
                        setReceiptConfirmStep(null);
                        setReceiptPreview(null);
                        try {
                          const rawText = await ocrReceipt(file);
                          setReceiptRawText(rawText);
                          const parsed = parseReceiptText(rawText);
                          setReceiptPreview(parsed);
                          setEditItems(parsed.items.map(it => ({ name: it.name, price: it.price.toFixed(2) })));
                          setReceiptConfirmStep("preview");
                        } catch {
                          toast({ title: "Scan failed", description: "Could not read the receipt. Try a clearer photo.", variant: "destructive" });
                          setReceiptFile(null);
                        } finally {
                          setReceiptScanning(false);
                        }
                      }}
                      data-testid="input-group-receipt"
                    />
                  </label>
                ) : null}

                {/* Receipt confirmation flow */}
                {receiptConfirmStep === "preview" && receiptPreview && (
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <p className="text-xs font-medium text-primary">Scanned: {receiptPreview.merchant}</p>
                    {receiptPreview.items.length > 0 ? (
                      <div className="max-h-32 overflow-y-auto space-y-1">
                        {receiptPreview.items.map((item: any, i: number) => (
                          <div key={i} className="flex justify-between text-xs">
                            <span className="truncate">{item.name}</span>
                            <span className="font-medium shrink-0 ml-2">${item.price.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No items could be extracted.</p>
                    )}
                    {receiptPreview.total != null && (
                      <div className="flex justify-between text-xs font-semibold border-t border-border pt-1">
                        <span>Total</span><span>${receiptPreview.total.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button type="button" size="sm" variant="default" className="flex-1 h-7 text-xs"
                        onClick={() => setReceiptConfirmStep(null)}
                      >Looks good</Button>
                      <Button type="button" size="sm" variant="outline" className="flex-1 h-7 text-xs"
                        onClick={() => setReceiptConfirmStep("options")}
                      >Not right</Button>
                    </div>
                  </div>
                )}

                {receiptConfirmStep === "options" && (
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">The scan didn't look right? Try one of these:</p>
                    <Button type="button" size="sm" variant="outline" className="w-full h-8 text-xs justify-start"
                      onClick={() => { setReceiptFile(null); setReceiptConfirmStep(null); setReceiptPreview(null); }}
                    ><Camera className="w-3 h-3 mr-2" />Scan again with a new photo</Button>
                    <Button type="button" size="sm" variant="outline" className="w-full h-8 text-xs justify-start"
                      onClick={() => setReceiptConfirmStep("edit")}
                    ><FileText className="w-3 h-3 mr-2" />Edit extracted text manually</Button>
                    <Button type="button" size="sm" variant="outline" className="w-full h-8 text-xs justify-start"
                      onClick={() => { setReceiptPreview(null); setReceiptConfirmStep(null); }}
                    ><Camera className="w-3 h-3 mr-2" />Just attach the photo</Button>
                    <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-2">
                      <p className="text-xs text-amber-600">
                        <strong>Premium</strong> — Get 95%+ accuracy with AI-powered scanning. Coming soon!
                      </p>
                    </div>
                  </div>
                )}

                {receiptConfirmStep === "edit" && (
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <p className="text-xs font-medium">Edit items:</p>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {editItems.map((item, i) => (
                        <div key={i} className="flex gap-1">
                          <input className="flex-1 text-xs border border-border rounded px-2 py-1 bg-background"
                            value={item.name} onChange={(e) => {
                              const copy = [...editItems]; copy[i] = { ...copy[i], name: e.target.value }; setEditItems(copy);
                            }} placeholder="Item name" />
                          <input className="w-20 text-xs border border-border rounded px-2 py-1 bg-background text-right"
                            value={item.price} onChange={(e) => {
                              const copy = [...editItems]; copy[i] = { ...copy[i], price: e.target.value }; setEditItems(copy);
                            }} placeholder="0.00" />
                          <button type="button" className="text-muted-foreground hover:text-destructive"
                            onClick={() => setEditItems(editItems.filter((_, j) => j !== i))}
                          ><X className="w-3 h-3" /></button>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="text-xs text-primary hover:underline"
                      onClick={() => setEditItems([...editItems, { name: "", price: "" }])}
                    >+ Add item</button>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="default" className="flex-1 h-7 text-xs"
                        onClick={() => {
                          const items = editItems.filter(it => it.name.trim() && parseFloat(it.price) > 0)
                            .map(it => ({ name: it.name.trim(), price: parseFloat(it.price) }));
                          const total = items.reduce((s, it) => s + it.price, 0);
                          setReceiptPreview({ ...receiptPreview, items, total: Math.round(total * 100) / 100 });
                          setReceiptConfirmStep(null);
                        }}
                      >Save changes</Button>
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={() => setReceiptConfirmStep("options")}
                      >Back</Button>
                    </div>
                  </div>
                )}

                {!receiptConfirmStep && !receiptScanning && (
                  <p className="text-xs text-muted-foreground">
                    {receiptPreview ? "Receipt scanned. Items will be saved with this expense." : "Photo will be sent via email to everyone in the split."}
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={
                  !description.trim() ||
                  !amount ||
                  !paidById ||
                  splitAmong.length === 0 ||
                  createExpenseMutation.isPending
                }
                data-testid="submit-expense"
              >
                {createExpenseMutation.isPending ? "Adding..." : "Add Expense"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Members bar with invite button */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {members.map((m) => {
          const role = getMemberRole(m.id);
          const canAct = canActOnMember(m.id);
          const isGhost = (m as any).isGhost;
          return (
            <div
              key={m.id}
              className={`flex flex-col items-center gap-1 shrink-0 relative ${isGhost ? "cursor-pointer" : canAct ? "cursor-pointer" : ""}`}
              onClick={() => {
                if (isGhost) { setGhostInviteMember(m); setGhostInviteEmail(""); }
                else if (canAct) setMemberActionMember(m);
              }}
              data-testid={`member-avatar-${m.id}`}
            >
              <div className="relative">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold ${isGhost ? "border-2 border-dashed border-amber-500/50" : ""}`}
                  style={{ backgroundColor: isGhost ? "transparent" : m.avatarColor, color: isGhost ? "hsl(var(--muted-foreground))" : undefined }}
                >
                  {isGhost ? <Ghost className="w-4 h-4 text-amber-500" /> : m.name[0]?.toUpperCase()}
                </div>
                {!isGhost && role === "owner" && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-yellow-500 flex items-center justify-center" title="Owner">
                    <Crown className="w-2.5 h-2.5 text-white" />
                  </span>
                )}
                {!isGhost && role === "admin" && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center" title="Admin">
                    <Shield className="w-2.5 h-2.5 text-white" />
                  </span>
                )}
                {isGhost && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center" title="Ghost — tap to invite">
                    <Mail className="w-2.5 h-2.5 text-white" />
                  </span>
                )}
              </div>
              <span className={`text-xs truncate max-w-[48px] ${isGhost ? "text-amber-500" : "text-muted-foreground"}`}>
                {m.id === user?.id ? "You" : m.name.split(" ")[0]}
              </span>
            </div>
          );
        })}
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <button
              className="flex flex-col items-center gap-1 shrink-0"
              data-testid="invite-member-btn"
            >
              <div className="w-9 h-9 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                <UserPlus className="w-4 h-4 text-muted-foreground" />
              </div>
              <span className="text-xs text-muted-foreground">Invite</span>
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite a Friend</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (inviteEmail.trim()) inviteMutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label>Friend's Email</Label>
                <Input
                  type="email"
                  placeholder="friend@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  data-testid="input-invite-email"
                />
                <p className="text-xs text-muted-foreground">
                  They must have a Spliiit account. Share the app link with them to sign up.
                </p>
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!inviteEmail.trim() || inviteMutation.isPending}
                data-testid="submit-invite"
              >
                {inviteMutation.isPending ? "Sending..." : "Send Invite"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Pending Invites Section */}
      {pendingInvites.length > 0 && (() => {
        const adminIds = group?.adminIds || [];
        const isOwnerOrAdmin = group && (
          group.createdById === user?.id ||
          adminIds.includes(user?.id || "") ||
          user?.isAdmin
        );
        return (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-amber-500">Pending Invites</h3>
            {pendingInvites.map((invite: any) => {
              const waitingAdmin = !invite.adminApproved;
              const waitingInvitee = invite.adminApproved && !invite.inviteeAccepted;
              return (
                <div
                  key={invite.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
                  data-testid={`pending-invite-${invite.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {invite.inviteeName}
                      <span className="text-muted-foreground font-normal"> invited by {invite.inviterName}</span>
                    </p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {waitingAdmin && (
                        <>
                          <Clock className="w-3 h-3 text-amber-500" />
                          <span className="text-xs text-amber-500">Waiting for admin approval</span>
                        </>
                      )}
                      {waitingInvitee && (
                        <>
                          <Clock className="w-3 h-3 text-blue-400" />
                          <span className="text-xs text-blue-400">Waiting for {invite.inviteeName} to accept</span>
                        </>
                      )}
                    </div>
                  </div>
                  {isOwnerOrAdmin && waitingAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                        onClick={() => approveInviteMutation.mutate(invite.id)}
                        disabled={approveInviteMutation.isPending}
                        data-testid={`approve-invite-${invite.id}`}
                        title="Approve invite"
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive hover:text-red-400 hover:bg-destructive/10"
                        onClick={() => rejectInviteMutation.mutate(invite.id)}
                        disabled={rejectInviteMutation.isPending}
                        data-testid={`reject-invite-${invite.id}`}
                        title="Reject invite"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Export + Settle Up + Simplify Debts */}
      {expenses.length > 0 && (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => exportGroupMutation.mutate()}
          disabled={exportGroupMutation.isPending}
          data-testid="export-group-expenses-btn"
        >
          {exportGroupMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Mail className="w-4 h-4 mr-1.5" />
          )}
          {exportGroupMutation.isPending ? "Sending..." : `Export ${group.name} expenses`}
        </Button>
      )}

      {/* Settle Up + Simplify Debts */}
      {expenses.length > 0 && (
        <div>
          <div className="flex gap-2 mb-3">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => setShowSimplified(!showSimplified)}
              data-testid="simplify-debts-btn"
            >
              <Shuffle className="w-4 h-4 mr-1.5" />
              {showSimplified ? "Hide Simplified" : "Simplify Debts"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setSettleUpOpen(true)}
              data-testid="group-settle-up-btn"
            >
              <HandCoins className="w-4 h-4 mr-1.5" />
              Settle Up
            </Button>
          </div>

          {showSimplified && (
            <div className="space-y-2 mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">Simplified settlements:</h3>
              {settlements.length > 0 ? settlements.map((s, i) => (
                <Card key={i} className="p-3 flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                    style={{ backgroundColor: getPersonColor(s.from) }}
                  >
                    {getPersonName(s.from)[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm text-muted-foreground">→</span>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                    style={{ backgroundColor: getPersonColor(s.to) }}
                  >
                    {getPersonName(s.to)[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{getPersonName(s.from)}</span>
                      <span className="text-muted-foreground"> pays </span>
                      <span className="font-medium">{getPersonName(s.to)}</span>
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-primary shrink-0">
                    ${s.amount.toFixed(2)}
                  </span>
                </Card>
              )) : (
                <p className="text-sm text-muted-foreground text-center py-2">All settled up.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Group Settle Up Dialog */}
      <Dialog open={settleUpOpen} onOpenChange={(open) => { setSettleUpOpen(open); if (!open) { setSettlePayerId(""); setSettleReceiverId(""); setSettleAmount(""); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Settle Up in {group.name}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (settlePayerId && settleReceiverId && settleAmount && settlePayerId !== settleReceiverId) {
                groupSettleUpMutation.mutate();
              }
            }}
          >
            <div className="space-y-2">
              <Label>Who is paying?</Label>
              <Select value={settlePayerId} onValueChange={setSettlePayerId}>
                <SelectTrigger data-testid="settle-payer-select">
                  <SelectValue placeholder="Select who is paying" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.id === user?.id ? `${m.name} (You)` : m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Paying to</Label>
              <Select value={settleReceiverId} onValueChange={setSettleReceiverId}>
                <SelectTrigger data-testid="settle-receiver-select">
                  <SelectValue placeholder="Select who receives" />
                </SelectTrigger>
                <SelectContent>
                  {members
                    .filter((m) => m.id !== settlePayerId)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.id === user?.id ? `${m.name} (You)` : m.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={settleAmount}
                onChange={(e) => setSettleAmount(e.target.value)}
                data-testid="settle-amount-input"
              />
            </div>
            {settlePayerId && settleReceiverId && settleAmount && (
              <div className="rounded-lg bg-muted/50 p-3 text-center space-y-1">
                <p className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{getPersonName(settlePayerId)}</span>
                  {" pay "}
                  <span className="font-semibold text-foreground">{getPersonName(settleReceiverId)}</span>
                </p>
                <p className="text-xl font-bold text-primary">
                  ${parseFloat(settleAmount).toFixed(2)}
                </p>
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={
                !settlePayerId ||
                !settleReceiverId ||
                !settleAmount ||
                settlePayerId === settleReceiverId ||
                groupSettleUpMutation.isPending
              }
              data-testid="confirm-group-settle-up"
            >
              <CheckCircle2 className="w-4 h-4 mr-1.5" />
              {groupSettleUpMutation.isPending ? "Settling..." : "Confirm Settlement"}
            </Button>
          </form>
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
                data-testid="confirm-delete-group-expense"
              >
                {deleteExpenseMutation.isPending ? "Deleting..." : "Yes, Delete"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Expense list */}
      {expenses.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Expenses</h3>
          {[...expenses]
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map((expense) => (
              <Card
                key={expense.id}
                className={`p-3 ${expense.isSettlement ? "border-primary/30 bg-primary/5" : ""}`}
                data-testid={`expense-card-${expense.id}`}
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
                    <p className="text-xs text-muted-foreground">
                      {expense.isSettlement
                        ? `${getPersonName(expense.paidById)} paid ${getPersonName(expense.splitAmongIds[0])} · ${new Date(expense.date).toLocaleDateString()}`
                        : `${getPersonName(expense.paidById)} paid · split ${expense.splitAmongIds.length} ways`
                      }
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-foreground shrink-0">
                    ${expense.amount.toFixed(2)}
                  </span>
                  {canDeleteExpense(expense) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleteExpenseId(expense.id)}
                      data-testid={`delete-group-expense-${expense.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </Card>
            ))}
        </div>
      ) : (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Receipt className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold mb-1">No expenses yet</h3>
          <p className="text-sm text-muted-foreground">
            Any group member can add expenses. Start splitting.
          </p>
        </Card>
      )}

      {/* Per-member balances */}
      {balances.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Member Balances</h3>
          <div className="space-y-1.5">
            {balances.map((b) => (
              <div key={b.personId} className="flex items-center justify-between gap-2 px-1">
                <span className="text-sm">{getPersonName(b.personId)}</span>
                <span
                  className={`text-sm font-semibold ${
                    b.amount > 0 ? "text-primary" : b.amount < 0 ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {b.amount > 0 ? "gets back" : b.amount < 0 ? "pays" : "settled"}{" "}
                  {b.amount !== 0 && `$${Math.abs(b.amount).toFixed(2)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete Group 2-step Confirmation Dialog */}
      <Dialog open={deleteGroupStep > 0} onOpenChange={(open) => { if (!open) setDeleteGroupStep(0); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteGroupStep === 1 ? "Delete Group" : "Final Warning"}
            </DialogTitle>
          </DialogHeader>
          {deleteGroupStep === 1 && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center gap-3 rounded-lg bg-destructive/10 p-4">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                <p className="text-sm text-foreground">
                  Are you sure you want to delete <strong>{group.name}</strong>?
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setDeleteGroupStep(0)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => setDeleteGroupStep(2)}
                >
                  Yes, Delete
                </Button>
              </div>
            </div>
          )}
          {deleteGroupStep === 2 && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg bg-destructive/10 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
                  <p className="text-sm font-semibold text-destructive">This is permanent</p>
                </div>
                <p className="text-sm text-foreground">
                  If you delete <strong>{group.name}</strong>, all expense history in this group will also be removed. This cannot be undone.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setDeleteGroupStep(0)}
                >
                  No, keep group
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => deleteGroupMutation.mutate()}
                  disabled={deleteGroupMutation.isPending}
                  data-testid="confirm-delete-group-final"
                >
                  {deleteGroupMutation.isPending ? "Deleting..." : "I understand, delete"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Member Action Dialog */}
      <Dialog open={!!memberActionMember} onOpenChange={(open) => { if (!open) setMemberActionMember(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {memberActionMember?.name}
              {memberActionMember && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {getMemberRole(memberActionMember.id) === "owner" ? "Owner" : getMemberRole(memberActionMember.id) === "admin" ? "Admin" : "Member"}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {memberActionMember && (
            <div className="space-y-2 pt-2">
              {/* Promote to Admin — owner only, for members */}
              {(isMeOwner || isMeGlobalAdmin) && getMemberRole(memberActionMember.id) === "member" && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => promoteMutation.mutate(memberActionMember.id)}
                  disabled={promoteMutation.isPending}
                  data-testid={`promote-member-${memberActionMember.id}`}
                >
                  <Shield className="w-4 h-4 mr-2 text-primary" />
                  {promoteMutation.isPending ? "Promoting..." : "Promote to Admin"}
                </Button>
              )}
              {/* Demote to Member — owner only, for admins */}
              {(isMeOwner || isMeGlobalAdmin) && getMemberRole(memberActionMember.id) === "admin" && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => demoteMutation.mutate(memberActionMember.id)}
                  disabled={demoteMutation.isPending}
                  data-testid={`demote-member-${memberActionMember.id}`}
                >
                  <UserMinus className="w-4 h-4 mr-2 text-muted-foreground" />
                  {demoteMutation.isPending ? "Demoting..." : "Demote to Member"}
                </Button>
              )}
              {/* Remove from Group — owner/admin, not for owner or other admins (unless you're owner) */}
              {getMemberRole(memberActionMember.id) !== "owner" &&
                (isMeOwner || isMeGlobalAdmin || (isMeAdmin && getMemberRole(memberActionMember.id) === "member")) && (
                <Button
                  variant="outline"
                  className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => removeMemberMutation.mutate(memberActionMember.id)}
                  disabled={removeMemberMutation.isPending}
                  data-testid={`remove-member-${memberActionMember.id}`}
                >
                  <X className="w-4 h-4 mr-2" />
                  {removeMemberMutation.isPending ? "Removing..." : "Remove from Group"}
                </Button>
              )}
            </div>
          )}
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

      {/* Ghost invite dialog */}
      <Dialog open={!!ghostInviteMember} onOpenChange={(open) => { if (!open) { setGhostInviteMember(null); setGhostInviteEmail(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ghost className="w-5 h-5 text-amber-500" />
              Invite {ghostInviteMember?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">
              <strong>{ghostInviteMember?.name}</strong> was imported from Splitwise but doesn't have a Spliiit account yet. Enter their email to send a signup invite.
            </p>
            <div className="space-y-2">
              <Label htmlFor="ghost-email">Email address</Label>
              <Input
                id="ghost-email"
                type="email"
                placeholder="friend@example.com"
                value={ghostInviteEmail}
                onChange={(e) => setGhostInviteEmail(e.target.value)}
                data-testid="ghost-invite-email"
              />
            </div>
            <Button
              className="w-full"
              onClick={handleGhostInvite}
              disabled={ghostInviting || !ghostInviteEmail.trim() || !ghostInviteEmail.includes("@")}
              data-testid="ghost-invite-submit"
            >
              {ghostInviting ? (
                <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending...</>
              ) : (
                <><Mail className="w-4 h-4 mr-1.5" />Send Invite</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Leave Group + Delete Group buttons at the bottom */}
      <div className="pt-2 space-y-1">
        {/* Leave Group — shown for all members */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground hover:text-foreground hover:bg-muted/50"
          onClick={() => leaveGroupMutation.mutate()}
          disabled={leaveGroupMutation.isPending}
          data-testid="leave-group-btn"
        >
          {leaveGroupMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <LogOut className="w-4 h-4 mr-1.5" />
          )}
          {leaveGroupMutation.isPending ? "Leaving..." : "Leave Group"}
        </Button>

        {/* Delete Group button — owner, admin, or global admin */}
        {(group.createdById === user?.id || (group.adminIds || []).includes(user?.id || "") || user?.isAdmin) && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive/70 hover:text-destructive hover:bg-destructive/10"
            onClick={() => setDeleteGroupStep(1)}
            data-testid="delete-group-btn"
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            Delete Group
          </Button>
        )}
      </div>
    </div>
  );
}
