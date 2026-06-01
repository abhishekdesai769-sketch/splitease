import { useState, useMemo, useEffect, useDeferredValue, useCallback, memo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SafeUser } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Shield, Trash2, RotateCcw, FolderX, ReceiptText,
  Search, Clock, AlertTriangle, KeyRound, Crown, Settings,
  Users, BarChart2, StickyNote, Smartphone, Mail, Chrome,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
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

// Memoized user card — only re-renders when this specific user's data changes,
// not when any other state in the Admin component changes (e.g. search input).
const UserCard = memo(function UserCard({
  u, isCurrent, onManage,
}: {
  u: SafeUser;
  isCurrent: boolean;
  onManage: (u: SafeUser) => void;
}) {
  const hasPremium = u.isPremium && u.premiumUntil
    ? new Date(u.premiumUntil) > new Date()
    : u.isPremium;
  const premiumUntilDate = u.premiumUntil
    ? new Date(u.premiumUntil).toLocaleDateString()
    : null;
  return (
    <Card className="p-3 flex items-center gap-3" data-testid={`approved-user-${u.id}`}>
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
              <Shield className="w-3 h-3" /> Admin
            </span>
          )}
          {hasPremium && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/15 text-yellow-500">
              <Crown className="w-3 h-3" /> Premium
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
        {hasPremium && premiumUntilDate && (
          <p className="text-[10px] text-yellow-500/70">Until {premiumUntilDate}</p>
        )}
      </div>
      {/* Manage button shown for ALL users including the current admin.
          Self-management is needed so the admin can grant themselves
          Premium for testing / personal use. Truly destructive actions
          (Delete User) are already gated by !selectedUser.isAdmin inside
          the modal, so the admin can't accidentally delete their own
          account from here. */}
      <Button size="icon" variant="ghost" title="Manage user" onClick={() => onManage(u)}>
        <Settings className="w-4 h-4 text-muted-foreground" />
      </Button>
    </Card>
  );
});

export default function Admin() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [premiumOnly, setPremiumOnly] = useState(false);
  // useDeferredValue: input stays instant; list filtering waits until browser is idle
  const deferredSearch = useDeferredValue(userSearchQuery);
  const [selectedUser, setSelectedUser] = useState<SafeUser | null>(null);
  const [premiumMonths, setPremiumMonths] = useState("3");
  const [newPassword, setNewPassword] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  // Fetch stats only when a user dialog is open — never refetch on window focus
  const { data: userStats, isLoading: statsLoading } = useQuery<{
    groups: { id: string; name: string; memberCount: number }[];
    expenseCount: number;
    totalPaid: number;
  }>({
    queryKey: ["/api/admin/users", selectedUser?.id, "stats"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/users/${selectedUser!.id}/stats`);
      return res.json();
    },
    enabled: !!selectedUser,
    staleTime: 5 * 60 * 1000,      // 5 min — no background refetch while dialog is open
    refetchOnWindowFocus: false,
  });

  // Sync adminNotes when a new user is selected
  useEffect(() => {
    setAdminNotes(selectedUser?.adminNotes ?? "");
  }, [selectedUser?.id]);

  const saveNotesMutation = useMutation({
    mutationFn: async ({ userId, notes }: { userId: string; notes: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}/notes`, { notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Notes saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const { data: allUsers = [], isLoading } = useQuery<SafeUser[]>({
    queryKey: ["/api/admin/users"],
    staleTime: 2 * 60 * 1000,      // 2 min — clicking search input won't re-fire this
    refetchOnWindowFocus: false,
  });

  const { data: deletedData } = useQuery<{
    groups: EnrichedGroup[];
    expenses: EnrichedExpense[];
  }>({
    queryKey: ["/api/admin/deleted"],
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

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
    onSuccess: async (data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      // If the admin granted/revoked Premium on THEMSELVES, useAuth's
      // local `user` state is now stale (it loaded once at app boot and
      // never auto-refreshes). Re-fetch /api/auth/me so the rest of the
      // app (Money tab, AI scan quota, recurring expenses, etc.) treats
      // the admin as Premium immediately, not after the next full reload.
      if (variables.userId === user?.id) {
        await refreshUser();
      }
      toast({ title: "Premium updated", description: data.message });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Stable handler for UserCard — useCallback so memo() on UserCard actually works
  const handleManageUser = useCallback((u: SafeUser) => {
    setSelectedUser(u);
    setPremiumMonths("3");
    setNewPassword("");
  }, []);

  // Filter users by search + premium toggle — runs off the critical path
  const filteredUsers = useMemo(() => {
    const uq = deferredSearch.toLowerCase().trim();
    return allUsers.filter((u) => {
      if (premiumOnly && !u.isPremium) return false;
      if (!uq) return true;
      return u.name.toLowerCase().includes(uq) || u.email.toLowerCase().includes(uq);
    });
  }, [allUsers, deferredSearch, premiumOnly]);

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

      {/* AI Mode usage observability — quota / spend / top spenders */}
      <AiUsagePanel />

      {/* Campaign runner — milestone / promo blasts (dry-run first) */}
      <CampaignPanel />

      {/* Approved Users */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Active Users ({allUsers.length})
        </h2>

        {/* User search + premium filter */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={userSearchQuery}
              onChange={(e) => setUserSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Button
            size="sm"
            variant={premiumOnly ? "default" : "outline"}
            className={`shrink-0 gap-1.5 h-9 ${premiumOnly ? "bg-yellow-500 hover:bg-yellow-600 text-white border-0" : ""}`}
            onClick={() => setPremiumOnly((v) => !v)}
          >
            <Crown className="w-3.5 h-3.5" />
            Premium
          </Button>
        </div>

        <div className="space-y-2">
          {filteredUsers.map((u) => (
            <UserCard
              key={u.id}
              u={u}
              isCurrent={u.id === user?.id}
              onManage={handleManageUser}
            />
          ))}
          {filteredUsers.length === 0 && deferredSearch && (
            <p className="text-sm text-muted-foreground text-center py-4">No users found for "{deferredSearch}"</p>
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

      {/* User Management Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={(open) => { if (!open) setSelectedUser(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                style={{ backgroundColor: selectedUser?.avatarColor }}
              >
                {selectedUser?.name[0]?.toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">{selectedUser?.name}</p>
                <p className="text-xs text-muted-foreground font-normal">{selectedUser?.email}</p>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1 max-h-[70vh] overflow-y-auto pr-1">

            {/* Account Info */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5" /> Account Info
              </p>
              <div className="rounded-lg bg-muted/40 p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Login method</span>
                  <span className="font-medium flex items-center gap-1">
                    {selectedUser?.googleId ? <><Chrome className="w-3 h-3" /> Google</> :
                     selectedUser?.appleId  ? <><Smartphone className="w-3 h-3" /> Apple</> :
                     <><Mail className="w-3 h-3" /> Email</>}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email verified</span>
                  <span className={`font-medium ${selectedUser?.isEmailVerified ? "text-green-500" : "text-destructive"}`}>
                    {selectedUser?.isEmailVerified ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">UTM source</span>
                  <span className="font-medium text-primary">
                    {selectedUser?.utmCampaign ?? <span className="text-muted-foreground">—</span>}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Premium</span>
                  <span className={`font-medium ${selectedUser?.isPremium ? "text-yellow-500" : "text-muted-foreground"}`}>
                    {selectedUser?.isPremium
                      ? selectedUser.premiumUntil
                        ? `Until ${new Date(selectedUser.premiumUntil).toLocaleDateString()}`
                        : "Active"
                      : "Free"}
                  </span>
                </div>
              </div>
            </div>

            <div className="border-t border-border" />

            {/* Activity */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <BarChart2 className="w-3.5 h-3.5" /> Activity
              </p>
              {statsLoading ? (
                <div className="h-12 bg-muted animate-pulse rounded-lg" />
              ) : (
                <div className="rounded-lg bg-muted/40 p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expenses added</span>
                    <span className="font-medium">{userStats?.expenseCount ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total paid</span>
                    <span className="font-medium">${(userStats?.totalPaid ?? 0).toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border" />

            {/* Groups */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Groups ({userStats?.groups.length ?? "…"})
              </p>
              {statsLoading ? (
                <div className="h-12 bg-muted animate-pulse rounded-lg" />
              ) : userStats?.groups.length === 0 ? (
                <p className="text-xs text-muted-foreground">Not in any groups yet</p>
              ) : (
                <div className="space-y-1">
                  {userStats?.groups.map(g => (
                    <div key={g.id} className="flex justify-between items-center rounded-md bg-muted/40 px-3 py-1.5 text-xs">
                      <span className="font-medium truncate">{g.name}</span>
                      <span className="text-muted-foreground shrink-0 ml-2">{g.memberCount} members</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border" />

            {/* Grant Premium */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5 text-yellow-500" /> Grant Premium
              </p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  max="120"
                  placeholder="Months (0 = revoke)"
                  value={premiumMonths}
                  onChange={(e) => setPremiumMonths(e.target.value)}
                  className="h-9 text-sm"
                />
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={grantPremiumMutation.isPending}
                  onClick={() => {
                    const months = parseInt(premiumMonths);
                    if (isNaN(months) || months < 0 || months > 120) {
                      toast({ title: "Error", description: "Enter 0–120 months", variant: "destructive" });
                      return;
                    }
                    grantPremiumMutation.mutate(
                      { userId: selectedUser!.id, months },
                      { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }) }
                    );
                  }}
                >
                  {parseInt(premiumMonths) === 0 ? "Revoke" : "Grant"}
                </Button>
              </div>
            </div>

            <div className="border-t border-border" />

            {/* Reset Password */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" /> Reset Password
              </p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder="New password (min 6 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-9 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={resetPasswordMutation.isPending || newPassword.length < 6}
                  onClick={() => {
                    resetPasswordMutation.mutate(
                      { userId: selectedUser!.id, newPassword },
                      { onSuccess: () => setNewPassword("") }
                    );
                  }}
                >
                  Reset
                </Button>
              </div>
            </div>

            <div className="border-t border-border" />

            {/* Admin Notes */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <StickyNote className="w-3.5 h-3.5" /> Admin Notes
              </p>
              <Textarea
                placeholder="e.g. Ottawa Gujarati admin — paid $75, post scheduled May 1, follow up May 15"
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                className="text-sm resize-none"
                rows={3}
              />
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={saveNotesMutation.isPending}
                onClick={() => saveNotesMutation.mutate({ userId: selectedUser!.id, notes: adminNotes })}
              >
                Save Notes
              </Button>
            </div>

            {/* Delete User */}
            {!selectedUser?.isAdmin && (
              <>
                <div className="border-t border-border" />
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                    <Trash2 className="w-3.5 h-3.5 text-destructive" /> Danger Zone
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (confirm(`Delete ${selectedUser?.name}? This removes them and their friend links.`)) {
                        deleteMutation.mutate(selectedUser!.id, {
                          onSuccess: () => setSelectedUser(null),
                        });
                      }
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                    Delete {selectedUser?.name}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// AI Mode usage panel — observability for admin
// Renders today's total spend, top spenders, last-7-day trend, plus the
// global degraded-state warning if AI Mode has been auto-paused.
// ───────────────────────────────────────────────────────────────────────────

interface AiUsageResponse {
  today: {
    date: string;
    totalEstimatedCents: number;
    uniqueUsers: number;
    totalTextTurns: number;
    totalImageAttachments: number;
    topSpenders: Array<{
      userId: string;
      userName: string;
      userEmail: string;
      textTurns: number;
      attachmentTurns: number;
      imageAttachments: number;
      pdfAttachments: number;
      estimatedCostCents: number;
    }>;
  };
  history: Array<{ date: string; totalCents: number; uniqueUsers: number }>;
  thresholds: { warningCents: number; killCents: number };
  degraded: boolean;
  degradedReason: string | null;
}

function AiUsagePanel() {
  const { data, isLoading } = useQuery<AiUsageResponse>({
    queryKey: ["/api/admin/ai-usage"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/admin/ai-usage");
      return r.json();
    },
    refetchInterval: 60_000, // refresh once a minute
  });

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BarChart2 className="w-4 h-4" />
          Loading AI Mode usage…
        </div>
      </Card>
    );
  }

  if (!data) return null;

  const todayDollars = (data.today.totalEstimatedCents / 100).toFixed(2);
  const warningDollars = (data.thresholds.warningCents / 100).toFixed(2);
  const killDollars = (data.thresholds.killCents / 100).toFixed(2);
  const pctOfWarning = Math.min(100, (data.today.totalEstimatedCents / data.thresholds.warningCents) * 100);
  const pctOfKill = Math.min(100, (data.today.totalEstimatedCents / data.thresholds.killCents) * 100);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">AI Mode Usage — {data.today.date}</h2>
        </div>
        {data.degraded && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 border border-red-500/30">
            <AlertTriangle className="w-3 h-3" />
            DEGRADED
          </span>
        )}
      </div>

      {data.degraded && data.degradedReason && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-xs text-red-700 dark:text-red-300">
          <strong>AI Mode auto-paused:</strong> {data.degradedReason}
        </div>
      )}

      {/* Top-line numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Today spend</p>
          <p className="text-base font-semibold font-mono">${todayDollars}</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active users</p>
          <p className="text-base font-semibold font-mono">{data.today.uniqueUsers}</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Text turns</p>
          <p className="text-base font-semibold font-mono">{data.today.totalTextTurns}</p>
        </div>
        <div className="rounded-lg bg-muted/40 p-2.5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Image uploads</p>
          <p className="text-base font-semibold font-mono">{data.today.totalImageAttachments}</p>
        </div>
      </div>

      {/* Spend vs thresholds — visual bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>Spend vs thresholds</span>
          <span>Warning: ${warningDollars} · Kill: ${killDollars}</span>
        </div>
        <div className="relative h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full ${pctOfKill > 75 ? "bg-red-500" : pctOfWarning > 75 ? "bg-amber-500" : "bg-primary"}`}
            style={{ width: `${pctOfKill}%` }}
          />
          {/* Tick marker at warning threshold position */}
          <div
            className="absolute top-0 bottom-0 w-px bg-amber-500/60"
            style={{ left: `${(data.thresholds.warningCents / data.thresholds.killCents) * 100}%` }}
          />
        </div>
      </div>

      {/* Top spenders */}
      {data.today.topSpenders.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Top spenders today</p>
          <div className="space-y-1">
            {data.today.topSpenders.slice(0, 10).map((s) => (
              <div key={s.userId} className="flex items-center justify-between text-xs border-b border-border last:border-0 py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{s.userName}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{s.userEmail}</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono shrink-0">
                  <span>{s.textTurns}T</span>
                  <span>{s.imageAttachments}I</span>
                  <span>{s.pdfAttachments}P</span>
                  <span className="font-semibold text-foreground min-w-[42px] text-right">
                    ${(s.estimatedCostCents / 100).toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            T = text turns · I = image uploads · P = PDF uploads
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">No AI Mode usage yet today.</p>
      )}

      {/* Last 7 days mini-trend */}
      {data.history.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Last 7 days</p>
          <div className="flex items-end gap-1 h-12">
            {data.history.slice().reverse().map((h) => {
              const maxCents = Math.max(...data.history.map((x) => x.totalCents), 1);
              const heightPct = (h.totalCents / maxCents) * 100;
              return (
                <div key={h.date} className="flex-1 flex flex-col items-center gap-0.5">
                  <div
                    className="w-full bg-primary/30 rounded-t-sm transition-all"
                    style={{ height: `${heightPct}%`, minHeight: "2px" }}
                    title={`${h.date}: $${(h.totalCents / 100).toFixed(2)} · ${h.uniqueUsers} users`}
                  />
                  <span className="text-[9px] text-muted-foreground">{h.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// CampaignPanel — admin panel for milestone / promo campaigns.
// Dry-run first (always shows audience counts before live), then live run.
// Uses the campaign_sends audit table so retries are idempotent.
// ───────────────────────────────────────────────────────────────────────────

interface CampaignRunReport {
  campaignId: string;
  dryRun: boolean;
  audience: {
    totalEligible: number;
    iosUsers: number;
    excludedByCurrency: number;
    alreadySentEmail: number;
    alreadySentPush: number;
    alreadyGrantedPremium: number;
  };
  results: {
    emailSent: number; emailSkipped: number; emailFailed: number;
    pushSent: number; pushSkipped: number; pushFailed: number;
    premiumGranted: number; premiumSkipped: number; premiumFailed: number;
  };
}

function CampaignPanel() {
  const { toast } = useToast();
  const [campaignId] = useState("milestone_1k_2026_06");
  const [report, setReport] = useState<CampaignRunReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);

  const run = async (dryRun: boolean) => {
    setIsRunning(true);
    try {
      const r = await apiRequest("POST", "/api/admin/campaigns/run", { campaignId, dryRun });
      const data = await r.json();
      setReport(data);
      if (!dryRun) {
        const { emailSent, pushSent, premiumGranted, emailFailed, pushFailed, premiumFailed } = data.results;
        toast({
          title: `Campaign sent`,
          description: `${emailSent} emails, ${pushSent} pushes, ${premiumGranted} Premium grants. Failures: ${emailFailed + pushFailed + premiumFailed}.`,
        });
        setConfirmLive(false);
      }
    } catch (err: any) {
      let msg = err.message;
      try {
        const body = JSON.parse(err.message.split(": ").slice(1).join(": "));
        msg = body.message || body.error || msg;
      } catch { /* */ }
      toast({ title: "Campaign run failed", description: msg, variant: "destructive" });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold">Campaigns — 1k milestone</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Sends email + iOS push + 30-day Premium grant (iOS only) + in-app banner.
        Excludes users with currency = INR. Idempotent — re-running skips users already sent.
      </p>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => run(true)} disabled={isRunning}>
          {isRunning ? "Running…" : "Dry-run (preview)"}
        </Button>
        {report && !confirmLive && (
          <Button size="sm" variant="default" onClick={() => setConfirmLive(true)} disabled={isRunning}>
            Send for real…
          </Button>
        )}
        {confirmLive && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-600 font-medium">Are you sure?</span>
            <Button size="sm" variant="destructive" onClick={() => run(false)} disabled={isRunning}>
              {isRunning ? "Sending…" : "Yes, send"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmLive(false)} disabled={isRunning}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      {report && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">
              {report.dryRun ? "Preview (no side effects)" : "Live run result"}
            </span>
            {!report.dryRun && (
              <span className="text-[10px] text-green-600 font-semibold">SENT</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-[10px] text-muted-foreground">Eligible</p>
              <p className="font-semibold font-mono">{report.audience.totalEligible}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">iOS users</p>
              <p className="font-semibold font-mono">{report.audience.iosUsers}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Excluded (INR)</p>
              <p className="font-semibold font-mono">{report.audience.excludedByCurrency}</p>
            </div>
          </div>
          {report.dryRun ? (
            <p className="text-[11px] text-muted-foreground italic pt-1 border-t border-border">
              Would send: {report.audience.totalEligible - report.audience.alreadySentEmail} emails,
              {" "}{report.audience.iosUsers - report.audience.alreadySentPush} pushes,
              {" "}{report.audience.iosUsers - report.audience.alreadyGrantedPremium} Premium grants.
            </p>
          ) : (
            <div className="pt-1 border-t border-border space-y-0.5">
              <p className="text-[11px]">
                <span className="text-green-600 font-medium">Sent:</span>{" "}
                {report.results.emailSent} emails · {report.results.pushSent} pushes · {report.results.premiumGranted} Premium grants
              </p>
              {(report.results.emailFailed + report.results.pushFailed + report.results.premiumFailed > 0) && (
                <p className="text-[11px] text-red-600">
                  Failed: {report.results.emailFailed} emails · {report.results.pushFailed} pushes · {report.results.premiumFailed} grants
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Skipped (already sent): {report.results.emailSkipped + report.results.pushSkipped + report.results.premiumSkipped}
              </p>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground italic">
        Required to fire: set <code className="px-1 bg-muted/60 rounded font-mono">CAMPAIGN_1K_ENABLED=true</code> on Render + redeploy.
      </p>
    </Card>
  );
}
