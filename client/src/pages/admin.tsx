import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SafeUser } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Shield, Trash2, RotateCcw, FolderX, ReceiptText,
  Search, Clock, AlertTriangle, KeyRound, Crown
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

interface EnrichedGroup {
  id: string;
  name: string;
  createdById: string;
  createdByName: string;
  createdByEmail: string;
  memberIds: string[];
  memberNames: string[];
  deletedAt: string | null;
}

interface EnrichedExpense {
  id: string;
  description: string;
  amount: number;
  paidById: string;
  paidByName: string;
  paidByEmail: string;
  addedById: string;
  addedByName: string;
  groupId: string | null;
  date: string;
  deletedAt: string | null;
}

function getDaysRemaining(deletedAt: string | null): number {
  if (!deletedAt) return 30;
  const deleted = new Date(deletedAt);
  const expiry = new Date(deleted);
  expiry.setDate(expiry.getDate() + 30);
  const now = new Date();
  const diff = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

function DaysRemainingBadge({ deletedAt }: { deletedAt: string | null }) {
  const days = getDaysRemaining(deletedAt);
  const isUrgent = days <= 7;
  const isCritical = days <= 3;

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
        isCritical
          ? "bg-red-500/20 text-red-400"
          : isUrgent
          ? "bg-amber-500/20 text-amber-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {isCritical ? (
        <AlertTriangle className="w-3 h-3" />
      ) : (
        <Clock className="w-3 h-3" />
      )}
      {days}d left
    </span>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [userSearchQuery, setUserSearchQuery] = useState("");

  const { data: allUsers = [], isLoading } = useQuery<SafeUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: deletedData } = useQuery<{
    groups: EnrichedGroup[];
    expenses: EnrichedExpense[];
  }>({ queryKey: ["/api/admin/deleted"] });

  const restoreGroupMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/restore/group/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deleted"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: "Group restored" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const restoreExpenseMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/admin/restore/expense/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deleted"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: "Expense restored" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/reset-password`, { newPassword });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Password reset", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const grantPremiumMutation = useMutation({
    mutationFn: async ({ userId, months }: { userId: string; months: number }) => {
      const res = await apiRequest("POST", `/api/admin/users/${userId}/grant-premium`, { months });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Premium updated", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Filter users by search
  const filteredUsers = useMemo(() => {
    const uq = userSearchQuery.toLowerCase().trim();
    if (!uq) return allUsers;
    return allUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(uq) ||
        u.email.toLowerCase().includes(uq)
    );
  }, [allUsers, userSearchQuery]);

  // Filter deleted items by search query
  const q = searchQuery.toLowerCase().trim();

  const filteredGroups = useMemo(() => {
    if (!deletedData?.groups) return [];
    if (!q) return deletedData.groups;
    return deletedData.groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.createdByName.toLowerCase().includes(q) ||
        g.createdByEmail.toLowerCase().includes(q) ||
        g.memberNames.some((m) => m.toLowerCase().includes(q))
    );
  }, [deletedData?.groups, q]);

  const filteredExpenses = useMemo(() => {
    if (!deletedData?.expenses) return [];
    if (!q) return deletedData.expenses;
    return deletedData.expenses.filter(
      (e) =>
        e.description.toLowerCase().includes(q) ||
        e.paidByName.toLowerCase().includes(q) ||
        e.paidByEmail.toLowerCase().includes(q) ||
        e.addedByName.toLowerCase().includes(q) ||
        String(e.amount).includes(q)
    );
  }, [deletedData?.expenses, q]);

  const hasDeletedItems =
    (deletedData?.groups?.length ?? 0) > 0 ||
    (deletedData?.expenses?.length ?? 0) > 0;

  const totalFiltered = filteredGroups.length + filteredExpenses.length;
  const totalDeleted =
    (deletedData?.groups?.length ?? 0) + (deletedData?.expenses?.length ?? 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage users and access control
        </p>
      </div>


      {/* Approved Users */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Active Users ({allUsers.length})
        </h2>

        {/* User search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={userSearchQuery}
            onChange={(e) => setUserSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>

        <div className="space-y-2">
          {filteredUsers.map((u) => {
            const hasPremium = u.isPremium && u.premiumUntil
              ? new Date(u.premiumUntil) > new Date()
              : u.isPremium;
            const premiumUntilDate = u.premiumUntil
              ? new Date(u.premiumUntil).toLocaleDateString()
              : null;
            return (
              <Card
                key={u.id}
                className="p-3 flex items-center gap-3"
                data-testid={`approved-user-${u.id}`}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                  style={{ backgroundColor: u.avatarColor }}
                >
                  {u.name[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium truncate">{u.name}</p>
                    {u.isAdmin && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary">
                        <Shield className="w-3 h-3" />
                        Admin
                      </span>
                    )}
                    {hasPremium && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/15 text-yellow-500">
                        <Crown className="w-3 h-3" />
                        Premium
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  {hasPremium && premiumUntilDate && (
                    <p className="text-[10px] text-yellow-500/70">Until {premiumUntilDate}</p>
                  )}
                </div>
                {u.id !== user?.id && (
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      title={hasPremium ? "Adjust or revoke premium" : "Grant premium"}
                      onClick={() => {
                        const input = prompt(
                          `Grant premium to ${u.name} (${u.email}):\n\nEnter number of months (1–12).\nEnter 0 to revoke premium.`
                        );
                        if (input === null) return;
                        const months = parseInt(input);
                        if (isNaN(months) || months < 0 || months > 120) {
                          toast({ title: "Error", description: "Enter a number between 0 and 120", variant: "destructive" });
                          return;
                        }
                        grantPremiumMutation.mutate({ userId: u.id, months });
                      }}
                    >
                      <Crown className={`w-4 h-4 ${hasPremium ? "text-yellow-500" : "text-muted-foreground"}`} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Reset password"
                      onClick={() => {
                        const pw = prompt(`Set new password for ${u.name} (${u.email}):\n\nMin 6 characters.`);
                        if (pw && pw.length >= 6) {
                          resetPasswordMutation.mutate({ userId: u.id, newPassword: pw });
                        } else if (pw) {
                          toast({ title: "Error", description: "Password must be at least 6 characters", variant: "destructive" });
                        }
                      }}
                      data-testid={`reset-pw-${u.id}`}
                    >
                      <KeyRound className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    {!u.isAdmin && (
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Delete user"
                        onClick={() => {
                          if (confirm(`Delete ${u.name}? This removes them and their friend links.`)) {
                            deleteMutation.mutate(u.id);
                          }
                        }}
                        data-testid={`delete-${u.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
          {filteredUsers.length === 0 && userSearchQuery && (
            <p className="text-sm text-muted-foreground text-center py-4">No users found for "{userSearchQuery}"</p>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {/* Deleted Items — Recycle Bin */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Recycle Bin
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Deleted items are kept for 30 days, then permanently removed.
        </p>

        {!hasDeletedItems ? (
          <Card className="p-4 text-center">
            <p className="text-sm text-muted-foreground">No deleted items to restore</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
                data-testid="deleted-search"
              />
            </div>

            {q && (
              <p className="text-xs text-muted-foreground">
                Showing {totalFiltered} of {totalDeleted} deleted items
              </p>
            )}

            {/* Deleted Groups */}
            {filteredGroups.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  <FolderX className="w-3.5 h-3.5" />
                  Deleted Groups ({filteredGroups.length})
                </h3>
                <div className="space-y-2">
                  {filteredGroups.map((g) => (
                    <Card
                      key={g.id}
                      className="p-3 border-destructive/20 bg-destructive/5"
                      data-testid={`deleted-group-${g.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-medium truncate">{g.name}</p>
                            <DaysRemainingBadge deletedAt={g.deletedAt} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Created by {g.createdByName} · {g.memberNames.length} members
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Deleted{" "}
                            {g.deletedAt
                              ? new Date(g.deletedAt).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              : ""}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => restoreGroupMutation.mutate(g.id)}
                          disabled={restoreGroupMutation.isPending}
                          data-testid={`restore-group-${g.id}`}
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1" />
                          Restore
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Deleted Expenses */}
            {filteredExpenses.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ReceiptText className="w-3.5 h-3.5" />
                  Deleted Expenses ({filteredExpenses.length})
                </h3>
                <div className="space-y-2">
                  {filteredExpenses.map((e) => (
                    <Card
                      key={e.id}
                      className="p-3 border-destructive/20 bg-destructive/5"
                      data-testid={`deleted-expense-${e.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-medium truncate">
                              {e.description}
                            </p>
                            <DaysRemainingBadge deletedAt={e.deletedAt} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            ${e.amount?.toFixed(2)} · Paid by {e.paidByName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Deleted{" "}
                            {e.deletedAt
                              ? new Date(e.deletedAt).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              : ""}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => restoreExpenseMutation.mutate(e.id)}
                          disabled={restoreExpenseMutation.isPending}
                          data-testid={`restore-expense-${e.id}`}
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1" />
                          Restore
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {q && totalFiltered === 0 && (
              <Card className="p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  No deleted items match "{searchQuery}"
                </p>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
