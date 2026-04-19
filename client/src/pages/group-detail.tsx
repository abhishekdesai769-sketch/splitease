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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, ArrowLeft, Trash2, Shuffle, Receipt, UserPlus, X, HandCoins, CheckCircle2, AlertTriangle, Camera, Mail, Loader2, Crown, Shield, LogOut, UserMinus, Clock, Check, Ghost, FileText, Pencil, MoreVertical, Upload, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { calculateGroupBalances, simplifyDebts, calculatePairwiseBalances } from "@/lib/simplify";

export default function GroupDetail({ groupId }: { groupId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // simplifyDebts is now a persistent group setting, read from group?.simplifyDebts
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

  // Expense detail dialog
  const [detailExpense, setDetailExpense] = useState<any>(null);

  // Receipt detail dialog
  const [receiptExpenseId, setReceiptExpenseId] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);


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

  // Import into group
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStep, setImportStep] = useState<"upload" | "map" | "preview">("upload");
  const [importCsvNames, setImportCsvNames] = useState<string[]>([]);
  const [importMapping, setImportMapping] = useState<Record<string, string>>({}); // csvName → userId or "new:email"
  const [importNewEmails, setImportNewEmails] = useState<Record<string, string>>({}); // csvName → email for new members
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importImporterName, setImportImporterName] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

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

  const deleteAllExpensesMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/groups/${groupId}/expenses`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/group", groupId] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
      toast({ title: "All expenses deleted" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setDescription("");
    setAmount("");
    setPaidById("");
    setSplitAmong([]);
    setGroupSplitType("equal");
    setReceiptFile(null);
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
  const simplifiedSettlements = simplifyDebts(balances);
  const pairwiseSettlements = calculatePairwiseBalances(expenses);

  // Personal view: only settlements involving the current user
  const myPairwise = pairwiseSettlements.filter(
    s => s.from === user?.id || s.to === user?.id
  );
  const mySimplified = simplifiedSettlements.filter(
    s => s.from === user?.id || s.to === user?.id
  );
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
              className={`text-xl font-semibold tracking-tight truncate font-serif ${(isMeOwner || isMeAdmin || isMeGlobalAdmin) ? "cursor-pointer hover:text-primary transition-colors" : ""}`}
              onClick={() => {
                if (isMeOwner || isMeAdmin || isMeGlobalAdmin) {
                  setNewGroupName(group.name);
                  setRenaming(true);
                }
              }}
            >
              <em className="italic text-accent-foreground not-italic-on-hover">{group.name}</em>
              {(isMeOwner || isMeAdmin || isMeGlobalAdmin) && (
                <Pencil className="w-3 h-3 inline ml-1.5 text-muted-foreground" />
              )}
            </h1>
          )}
          <p className="text-sm text-muted-foreground font-mono">
            {members.length} members · ${totalGroupSpend.toFixed(2)} total
          </p>
        </div>
        {/* Three-dots group actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" data-testid="group-actions-menu">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {(isMeOwner || isMeAdmin || isMeGlobalAdmin) && (
              <DropdownMenuItem onClick={() => { setNewGroupName(group.name); setRenaming(true); }}>
                <Pencil className="w-4 h-4 mr-2" /> Rename Group
              </DropdownMenuItem>
            )}
            {(isMeOwner || isMeAdmin || isMeGlobalAdmin) && (
              <DropdownMenuItem onClick={() => { setImportStep("upload"); setImportFile(null); setImportResult(null); setImportOpen(true); }}>
                <Upload className="w-4 h-4 mr-2" /> Import from Splitwise
              </DropdownMenuItem>
            )}
            {expenses.length > 0 && (
              <DropdownMenuItem onClick={() => exportGroupMutation.mutate()} disabled={exportGroupMutation.isPending}>
                <Download className="w-4 h-4 mr-2" /> Export Expenses
              </DropdownMenuItem>
            )}
            {(isMeOwner || isMeAdmin || isMeGlobalAdmin) && expenses.length > 0 && (
              <DropdownMenuItem onClick={async () => {
                try {
                  await apiRequest("PATCH", `/api/groups/${groupId}/simplify-debts`, { simplifyDebts: !group.simplifyDebts });
                  queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] });
                } catch {}
              }}>
                <Shuffle className="w-4 h-4 mr-2" /> {group.simplifyDebts ? "Simplify: ON" : "Simplify: OFF"}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => leaveGroupMutation.mutate()} disabled={leaveGroupMutation.isPending}>
              <LogOut className="w-4 h-4 mr-2" /> Leave Group
            </DropdownMenuItem>
            {(isMeOwner || isMeAdmin || isMeGlobalAdmin) && expenses.length > 0 && (
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => {
                if (confirm(`Delete all ${expenses.length} expenses in this group? This cannot be undone.`)) {
                  deleteAllExpensesMutation.mutate();
                }
              }}>
                <Trash2 className="w-4 h-4 mr-2" /> Delete All Expenses
              </DropdownMenuItem>
            )}
            {(isMeOwner || isMeAdmin || isMeGlobalAdmin) && (
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteGroupStep(1)}>
                <Trash2 className="w-4 h-4 mr-2" /> Delete Group
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

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

              {/* Receipt upload (simple attach — photo is emailed to all participants) */}
              <div className="space-y-2">
                <Label>Receipt (optional)</Label>
                {receiptFile ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border p-2.5">
                    <Camera className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm truncate flex-1">{receiptFile.name}</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setReceiptFile(null)}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 p-3 cursor-pointer hover:bg-muted/50 transition-colors">
                    <Camera className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Attach receipt photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) setReceiptFile(f); }}
                      data-testid="input-group-receipt"
                    />
                  </label>
                )}
                <p className="text-xs text-muted-foreground">Photo will be sent via email to everyone in the split.</p>
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

      {/* Your Balances + Settle Up */}
      {expenses.length > 0 && (
        <div>
          {/* Net total heading */}
          {(() => {
            const myBal = balances.find(b => b.personId === user?.id);
            const net = myBal ? Math.round(myBal.amount * 100) / 100 : 0;
            if (net === 0) return (
              <p className="text-base font-semibold text-muted-foreground text-center py-2">You're all settled up!</p>
            );
            return (
              <p className="text-base font-semibold mb-3">
                {net > 0 ? "You are owed " : "You owe "}
                <span className={net > 0 ? "text-primary" : "text-destructive"}>${Math.abs(net).toFixed(2)}</span>
                {" in total"}
              </p>
            );
          })()}

          {/* Personal balance view */}
          {(() => {
            const mySettlements = group.simplifyDebts ? mySimplified : myPairwise;
            if (mySettlements.length === 0) return null;
            return (
              <div className="space-y-2 mb-3">
                <h3 className="text-sm font-medium text-muted-foreground font-serif">
                  {group.simplifyDebts ? "Your simplified settlements:" : "Your balances:"}
                </h3>
                {mySettlements.map((s, i) => {
                  const youOwe = s.from === user?.id;
                  const otherPerson = youOwe ? s.to : s.from;
                  return (
                    <Card key={i} className="p-3 flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                        style={{ backgroundColor: getPersonColor(otherPerson) }}
                      >
                        {getPersonName(otherPerson)[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">
                          {youOwe ? (
                            <>
                              <span className="text-destructive font-medium">You owe</span>
                              {" "}<span className="font-medium">{getPersonName(otherPerson)}</span>
                            </>
                          ) : (
                            <>
                              <span className="font-medium">{getPersonName(otherPerson)}</span>
                              {" "}<span className="text-primary font-medium">owes you</span>
                            </>
                          )}
                        </p>
                      </div>
                      <span className={`text-sm font-semibold shrink-0 font-mono ${youOwe ? "text-destructive" : "text-primary"}`}>
                        ${s.amount.toFixed(2)}
                      </span>
                    </Card>
                  );
                })}
              </div>
            );
          })()}

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setSettleUpOpen(true)}
            data-testid="group-settle-up-btn"
          >
            <HandCoins className="w-4 h-4 mr-1.5" />
            Settle Up
          </Button>
        </div>
      )}

      {/* Member Balances — right before expenses (excludes current user) */}
      {balances.filter(b => b.personId !== user?.id).length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2 font-serif">Member Balances</h3>
          <div className="space-y-1.5">
            {balances.filter(b => b.personId !== user?.id).map((b) => (
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
          <h3 className="text-sm font-medium text-muted-foreground font-serif">Expenses</h3>
          {[...expenses]
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map((expense) => (
              <Card
                key={expense.id}
                className={`p-3 cursor-pointer ${expense.isSettlement ? "border-primary/30 bg-primary/5" : ""}`}
                data-testid={`expense-card-${expense.id}`}
                onClick={() => setDetailExpense(expense)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${expense.isSettlement ? "bg-primary/20" : "bg-primary/10"}`}>
                    {expense.isSettlement ? (
                      <CheckCircle2 className="w-4 h-4 text-primary" />
                    ) : (
                      <Receipt className="w-4 h-4 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {expense.isSettlement ? "Settlement" : expense.description}
                      {(expense as any).receiptData && (
                        <FileText className="w-3 h-3 text-primary inline ml-1 -mt-0.5" />
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {expense.isSettlement
                        ? `${getPersonName(expense.paidById)} paid ${getPersonName(expense.splitAmongIds[0])} · ${new Date(expense.date).toLocaleDateString()}`
                        : `${getPersonName(expense.paidById)} paid · split ${expense.splitAmongIds.length} ways`
                      }
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-foreground shrink-0 font-mono">
                    ${expense.amount.toFixed(2)}
                  </span>
                  {canDeleteExpense(expense) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); setDeleteExpenseId(expense.id); }}
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

      {/* Expense Detail Dialog */}
      <Dialog open={!!detailExpense} onOpenChange={(open) => { if (!open) setDetailExpense(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailExpense?.isSettlement ? "Settlement" : detailExpense?.description}</DialogTitle>
          </DialogHeader>
          {detailExpense && (
            <div className="space-y-4 pt-2">
              {/* Amount + Date */}
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-primary">${detailExpense.amount.toFixed(2)}</span>
                <span className="text-sm text-muted-foreground font-mono">{new Date(detailExpense.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              </div>

              {/* Paid by */}
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">Paid by</p>
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                    style={{ backgroundColor: getPersonColor(detailExpense.paidById) }}
                  >
                    {getPersonName(detailExpense.paidById)[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm font-medium">{getPersonName(detailExpense.paidById)}</span>
                </div>
              </div>

              {/* Split between */}
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  {detailExpense.isSettlement ? "Paid to" : `Split between ${detailExpense.splitAmongIds.length} ${detailExpense.splitAmongIds.length === 1 ? "person" : "people"}`}
                </p>
                <div className="space-y-1.5">
                  {(() => {
                    let customSplits: Record<string, number> | null = null;
                    if ((detailExpense as any).splitAmounts) {
                      try { customSplits = JSON.parse((detailExpense as any).splitAmounts); } catch {}
                    }
                    return detailExpense.splitAmongIds.map((personId: string) => {
                      const share = customSplits
                        ? (customSplits[personId] || 0)
                        : detailExpense.amount / detailExpense.splitAmongIds.length;
                      return (
                        <div key={personId} className="flex items-center justify-between gap-2 py-1">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                              style={{ backgroundColor: getPersonColor(personId) }}
                            >
                              {getPersonName(personId)[0]?.toUpperCase()}
                            </div>
                            <span className="text-sm">{getPersonName(personId)}</span>
                          </div>
                          <span className="text-sm font-medium">${share.toFixed(2)}</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Added by */}
              <p className="text-xs text-muted-foreground">
                Added by {getPersonName(detailExpense.addedById)}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

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

      {/* Import from Splitwise Dialog */}
      <Dialog open={importOpen} onOpenChange={(open) => { if (!open) { setImportOpen(false); setImportFile(null); setImportStep("upload"); setImportResult(null); } else { setImportOpen(true); }}}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import from Splitwise</DialogTitle>
          </DialogHeader>

          {importResult ? (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 text-primary">
                <CheckCircle2 className="w-5 h-5" />
                <span className="font-medium">Import complete!</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {importResult.imported} expenses imported, {importResult.skipped} skipped.
              </p>
              {importResult.ghostMembers?.length > 0 && (
                <div className="text-sm">
                  <p className="font-medium mb-1">New members created (ghost):</p>
                  {importResult.ghostMembers.map((g: any) => (
                    <p key={g.id} className="text-muted-foreground">· {g.name}</p>
                  ))}
                </div>
              )}
              <Button className="w-full" onClick={() => { setImportOpen(false); queryClient.invalidateQueries({ queryKey: ["/api/expenses/group", groupId] }); queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId] }); queryClient.invalidateQueries({ queryKey: ["/api/groups", groupId, "members"] }); }}>
                Done
              </Button>
            </div>
          ) : importStep === "upload" ? (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                Upload your Splitwise CSV export. Go to Splitwise → Group → Export → Download CSV.
              </p>
              <div
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => document.getElementById("import-csv-input")?.click()}
              >
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                {importFile ? (
                  <p className="text-sm font-medium">{importFile.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">Click to select CSV file</p>
                )}
                <input id="import-csv-input" type="file" accept=".csv" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0]; if (f) setImportFile(f);
                }} />
              </div>
              <Button className="w-full" disabled={!importFile || importLoading} onClick={async () => {
                if (!importFile) return;
                setImportLoading(true);
                try {
                  const text = await importFile.text();
                  const lines = text.split(/\r?\n/).filter(l => l.trim());
                  if (lines.length < 2) { toast({ title: "Error", description: "CSV is empty", variant: "destructive" }); return; }
                  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
                  const currIdx = headers.findIndex(h => h.toLowerCase() === "currency");
                  if (currIdx === -1) { toast({ title: "Error", description: "Invalid Splitwise CSV — missing Currency column", variant: "destructive" }); return; }
                  const csvNames = headers.slice(currIdx + 1).map(n => n.trim()).filter(n => n);
                  if (csvNames.length === 0) { toast({ title: "Error", description: "No person columns found in CSV", variant: "destructive" }); return; }

                  // Auto-match: try to match CSV names to group members
                  const mapping: Record<string, string> = {};
                  for (const csvName of csvNames) {
                    const cn = csvName.toLowerCase();
                    const match = members.find(m => m.name.toLowerCase() === cn)
                      || members.find(m => m.name.toLowerCase().includes(cn) || cn.includes(m.name.toLowerCase()))
                      || members.find(m => m.name.toLowerCase().split(" ")[0] === cn.split(" ")[0]);
                    if (match) mapping[csvName] = match.id;
                  }

                  // Parse ALL data rows for accurate count, show first 25 in preview
                  const dateIdx = headers.findIndex(h => h.toLowerCase() === "date");
                  const descIdx = headers.findIndex(h => h.toLowerCase() === "description");
                  const costIdx = headers.findIndex(h => h.toLowerCase() === "cost");
                  const allRows = lines.slice(1).map(line => {
                    const cols = line.split(",").map(c => c.replace(/^"|"$/g, "").trim());
                    return { date: cols[dateIdx] || "", description: cols[descIdx] || "", cost: cols[costIdx] || "0" };
                  }).filter(r => r.description && r.description.length > 0 && !r.description.toLowerCase().includes("total balance"));
                  const preview = allRows;

                  setImportCsvNames(csvNames);
                  setImportMapping(mapping);
                  setImportNewEmails({});
                  setImportPreview(preview);
                  setImportImporterName("");
                  setImportStep("map");
                } catch (err: any) {
                  toast({ title: "Error", description: "Failed to parse CSV", variant: "destructive" });
                } finally {
                  setImportLoading(false);
                }
              }}>
                {importLoading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                {importLoading ? "Parsing..." : "Continue"}
              </Button>
            </div>
          ) : importStep === "map" ? (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                Match each person in the CSV to a group member. Select "You" for your own column.
              </p>

              {/* Which CSV column is YOU */}
              <div className="space-y-2">
                <Label>Which column is you?</Label>
                <Select value={importImporterName} onValueChange={v => {
                  setImportImporterName(v);
                  setImportMapping(prev => ({ ...prev, [v]: user?.id || "" }));
                }}>
                  <SelectTrigger><SelectValue placeholder="Select your name in CSV" /></SelectTrigger>
                  <SelectContent>
                    {importCsvNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Map other CSV names to group members */}
              {importCsvNames.filter(n => n !== importImporterName).map(csvName => (
                <div key={csvName} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{csvName}</Label>
                  <Select value={importMapping[csvName] || ""} onValueChange={v => {
                    setImportMapping(prev => ({ ...prev, [csvName]: v }));
                    if (v !== "__new__") setImportNewEmails(prev => { const n = { ...prev }; delete n[csvName]; return n; });
                  }}>
                    <SelectTrigger><SelectValue placeholder="Select member..." /></SelectTrigger>
                    <SelectContent>
                      {csvName.toLowerCase().includes("(removed)") && (
                        <SelectItem value="__skip__">Skip — don't add to group</SelectItem>
                      )}
                      {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name} ({m.email.includes("placeholder") ? "ghost" : m.email})</SelectItem>)}
                      <SelectItem value="__new__">+ New member (enter email)</SelectItem>
                    </SelectContent>
                  </Select>
                  {importMapping[csvName] === "__new__" && (
                    <Input
                      type="email"
                      placeholder="Email address..."
                      value={importNewEmails[csvName] || ""}
                      onChange={e => setImportNewEmails(prev => ({ ...prev, [csvName]: e.target.value }))}
                      className="h-8 text-sm"
                    />
                  )}
                </div>
              ))}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setImportStep("upload")}>Back</Button>
                <Button className="flex-1" disabled={!importImporterName || importCsvNames.filter(n => n !== importImporterName).some(n => !importMapping[n] || (importMapping[n] === "__new__" && !importNewEmails[n]))} onClick={() => setImportStep("preview")}>
                  Preview ({importPreview.length} expenses)
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                {importPreview.length} expenses will be imported. Duplicates (same date + amount + description) are skipped.
              </p>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {importPreview.slice(0, 25).map((r, i) => (
                  <div key={i} className="flex justify-between text-xs py-1 border-b border-muted/30">
                    <span className="truncate flex-1">{r.description}</span>
                    <span className="text-muted-foreground ml-2">{r.date}</span>
                    <span className="font-medium ml-2">${Number(r.cost).toFixed(2)}</span>
                  </div>
                ))}
                {importPreview.length > 25 && (
                  <p className="text-xs text-muted-foreground text-center py-1">... and {importPreview.length - 25} more</p>
                )}
              </div>

              {/* Mapping summary */}
              <div className="text-xs space-y-0.5">
                <p className="font-medium">Member mapping:</p>
                {importCsvNames.map(n => {
                  const mappedId = importMapping[n];
                  const member = members.find(m => m.id === mappedId);
                  const label = n === importImporterName ? "You" : mappedId === "__skip__" ? "Skipped" : mappedId === "__new__" ? `New (${importNewEmails[n]})` : member?.name || "?";
                  return <p key={n} className="text-muted-foreground">{n} → {label}</p>;
                })}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setImportStep("map")}>Back</Button>
                <Button className="flex-1" disabled={importLoading} onClick={async () => {
                  if (!importFile) return;
                  setImportLoading(true);
                  try {
                    const formData = new FormData();
                    formData.append("file", importFile);
                    formData.append("groupId", groupId);
                    formData.append("mapping", JSON.stringify(
                      Object.fromEntries(importCsvNames.map(n => {
                        if (n === importImporterName) return [n, { type: "self" }];
                        if (importMapping[n] === "__skip__") return [n, { type: "skip" }];
                        if (importMapping[n] === "__new__") return [n, { type: "new", email: importNewEmails[n] }];
                        return [n, { type: "member", userId: importMapping[n] }];
                      }))
                    ));
                    const res = await apiFormRequest("POST", `/api/groups/${groupId}/import-mapped`, formData);
                    const data = await res.json();
                    setImportResult(data);
                  } catch (err: any) {
                    let msg = err.message;
                    try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
                    toast({ title: "Import failed", description: msg, variant: "destructive" });
                  } finally {
                    setImportLoading(false);
                  }
                }}>
                  {importLoading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Upload className="w-4 h-4 mr-1.5" />}
                  {importLoading ? "Importing..." : "Import"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
