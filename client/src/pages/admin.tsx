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
import { AdminLayout, getActiveSection, type AdminSection } from "@/components/AdminLayout";

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
  const [selectedUser, setSelectedUserRaw] = useState<SafeUser | null>(null);

  // Setter wrapper that ALSO syncs the URL so user-detail views are
  // deep-linkable. When a user opens, push #/admin/users/<id>; when the
  // modal closes, pop back to #/admin/users. Browser back/forward works
  // naturally because the hashchange listener (below) flows updates the
  // other direction too.
  const setSelectedUser = useCallback((u: SafeUser | null) => {
    setSelectedUserRaw(u);
    const hash = u ? `#/admin/users/${u.id}` : "#/admin/users";
    if (window.location.hash !== hash) {
      // Avoid recursive hashchange firing when WE'RE the one setting it.
      window.history.replaceState(null, "", hash);
    }
  }, []);
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

  // ── Section dispatch ────────────────────────────────────────────────
  // We keep all the user-mgmt hooks/state in this parent component (no
  // re-architecture). Just gate which UI block renders per active section.
  // This is what makes the refactor SAFE: all the existing user-mgmt
  // queries/mutations/dialogs continue to work identically — they're just
  // visible only when the "users" section is active.
  const [activeSection, setActiveSection] = useState<AdminSection>(getActiveSection());
  // Sub-tab within the Users section: "active" (the user list) vs
  // "recycle" (deleted groups + expenses). Defaults to active.
  const [usersTab, setUsersTab] = useState<"active" | "recycle">("active");

  // Deep-link to a specific user via #/admin/users/<id>. On hash change OR
  // when the user list finishes loading, if the URL points at a user, open
  // that user's dialog. Lets you bookmark a user page and share URLs with
  // any future co-admin.
  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash || "";
      const m = hash.match(/^#\/admin\/users\/([^/?#]+)/);
      const targetId = m?.[1];
      if (!targetId) {
        // URL doesn't point at a user; clear selection if one is open via URL nav.
        return;
      }
      if (selectedUser?.id === targetId) return; // already showing this user
      const found = allUsers.find((u) => u.id === targetId);
      if (found) setSelectedUserRaw(found);
    };
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUsers]);
  useEffect(() => {
    const onHashChange = () => setActiveSection(getActiveSection());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const sectionTitle = {
    home: "Home",
    users: "Users",
    "ai-mode": "AI Mode",
    errors: "Errors",
    campaigns: "Campaigns",
  }[activeSection];

  return (
    <AdminLayout pageTitle={sectionTitle}>
      {/* Home — action-first dashboard. Search-first, spend gauge prominent. */}
      {activeSection === "home" && (
        <AdminHomePanel allUsers={allUsers} />
      )}

      {/* AI Mode — dedicated section, same panel as before */}
      {activeSection === "ai-mode" && (
        <div className="space-y-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">AI Mode</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Daily spend, top spenders, 7-day trend, and the kill switch.
            </p>
          </div>
          <AiUsagePanel />
        </div>
      )}

      {/* Errors — dedicated section */}
      {activeSection === "errors" && (
        <div className="space-y-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Customer-facing errors</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Auto-logged from the frontend. Mark reviewed as you triage.
            </p>
          </div>
          <ClientErrorsPanel />
        </div>
      )}

      {/* Campaigns — dedicated section */}
      {activeSection === "campaigns" && (
        <div className="space-y-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Campaigns</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Dry-run first, then send for real. Idempotent — re-sends skip already-sent users.
            </p>
          </div>
          <CampaignPanel />
        </div>
      )}

      {/* Users — the big one. Existing user-mgmt UI lives here unchanged. */}
      {activeSection === "users" && (
        <div className="space-y-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Users</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Search, grant Premium, reset passwords, view stats, manage the recycle bin.
            </p>
          </div>

      {/* Tabs: Active vs Recycle bin */}
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setUsersTab("active")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            usersTab === "active"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          data-testid="users-tab-active"
        >
          Active ({allUsers.length})
        </button>
        <button
          type="button"
          onClick={() => setUsersTab("recycle")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            usersTab === "recycle"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          data-testid="users-tab-recycle"
        >
          Recycle bin{totalDeleted > 0 && ` (${totalDeleted})`}
        </button>
      </div>

      {/* Approved Users */}
      {usersTab === "active" && (<>
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
      </>)}

      {/* Deleted Items — Recycle Bin (sub-tab of Users) */}
      {usersTab === "recycle" && (<>
      <div>
        <p className="text-xs text-muted-foreground mb-3">
          Deleted groups and expenses. Restorable for 30 days, then permanently removed.
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
      </>)}

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
      )}
    </AdminLayout>
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

// ───────────────────────────────────────────────────────────────────────────
// AdminHomePanel — the action-first landing for /admin/home.
//
// Layout (per design call): user search bar first, AI spend gauge prominent,
// quick stats strip, then recent errors + today's new signups side by side.
// Goal: 80% of admin daily work is one tap away from this page.
// ───────────────────────────────────────────────────────────────────────────

function AdminHomePanel({ allUsers }: { allUsers: SafeUser[] }) {
  const [search, setSearch] = useState("");

  // Reuse existing endpoints — no new backend work needed.
  const { data: aiUsage } = useQuery<AiUsageResponse>({
    queryKey: ["/api/admin/ai-usage"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/admin/ai-usage");
      return r.json();
    },
    refetchInterval: 60_000,
  });
  const { data: errorsResp } = useQuery<ClientErrorsResponse>({
    queryKey: ["/api/admin/client-errors?all=0"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/admin/client-errors?all=0");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  // ── Search results ─────────────────────────────────────────────────────
  // Filter the existing user list client-side. Already loaded by the parent
  // so no extra fetch. Limit to top 6 matches in the dropdown.
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return allUsers
      .filter((u) =>
        u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [search, allUsers]);

  // ── KPI numbers ────────────────────────────────────────────────────────
  const totalUsers = allUsers.length;
  const premiumUsers = allUsers.filter((u) => u.isPremium).length;
  const premiumPct = totalUsers > 0 ? Math.round((premiumUsers / totalUsers) * 100) : 0;
  const todayDollars = aiUsage ? (aiUsage.today.totalEstimatedCents / 100).toFixed(2) : "0.00";
  const errorsTodayCount = (errorsResp?.errors || []).filter((e) => {
    const occurred = new Date(e.occurredAt).getTime();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return occurred > dayAgo;
  }).length;

  // ── New signups today ──────────────────────────────────────────────────
  const startOfDayUtc = (() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  })();
  const newSignupsToday = useMemo(() => {
    return allUsers
      .filter((u) => (u as any).createdAt && (u as any).createdAt > startOfDayUtc)
      .sort((a, b) => ((b as any).createdAt > (a as any).createdAt ? 1 : -1));
  }, [allUsers, startOfDayUtc]);

  // ── AI spend gauge values ──────────────────────────────────────────────
  const pctOfKill = aiUsage
    ? Math.min(100, (aiUsage.today.totalEstimatedCents / aiUsage.thresholds.killCents) * 100)
    : 0;
  const pctOfWarning = aiUsage
    ? Math.min(100, (aiUsage.today.totalEstimatedCents / aiUsage.thresholds.warningCents) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* ── Search + spend gauge: the two daily flows, side by side on wide ── */}
      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        {/* User search — biggest, focused on mount */}
        <Card className="p-4">
          <label className="text-[11px] uppercase tracking-wider font-mono text-muted-foreground">
            Find a user
          </label>
          <div className="relative mt-1.5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              autoFocus
              type="search"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-11"
              data-testid="admin-home-user-search"
            />
          </div>
          {searchResults.length > 0 && (
            <div className="mt-2 border border-border rounded-lg overflow-hidden">
              {searchResults.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    // Navigate to Users section + pre-fill search there.
                    // (Full per-user detail page arrives in Phase 4.)
                    window.location.hash = `#/admin/users?q=${encodeURIComponent(u.email)}`;
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-muted/40 border-b border-border last:border-0 text-left"
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                    style={{ backgroundColor: AVATAR_COLORS[u.id.charCodeAt(0) % AVATAR_COLORS.length] }}
                  >
                    {u.name?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{u.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{u.email}</p>
                  </div>
                  {u.isPremium && (
                    <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}
          {search.trim().length >= 2 && searchResults.length === 0 && (
            <p className="text-xs text-muted-foreground italic mt-2">No matches.</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-2">
            Type 2+ chars. Click a result to jump into Users.
          </p>
        </Card>

        {/* AI spend gauge — compact, with link into the AI Mode section */}
        <Card className="p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] uppercase tracking-wider font-mono text-muted-foreground">
              AI Mode spend today
            </label>
            {aiUsage?.degraded && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 border border-red-500/30">
                <AlertTriangle className="w-3 h-3" />
                DEGRADED
              </span>
            )}
          </div>
          <p className="text-2xl font-semibold font-mono">${todayDollars}</p>
          {aiUsage && (
            <>
              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full ${pctOfKill > 75 ? "bg-red-500" : pctOfWarning > 75 ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${pctOfKill}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 w-px bg-amber-500/60"
                  style={{ left: `${(aiUsage.thresholds.warningCents / aiUsage.thresholds.killCents) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                Warning at ${(aiUsage.thresholds.warningCents / 100).toFixed(2)} ·
                Kill at ${(aiUsage.thresholds.killCents / 100).toFixed(2)}
              </p>
            </>
          )}
          <a
            href="#/admin/ai-mode"
            className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1"
          >
            Full AI Mode view →
          </a>
        </Card>
      </div>

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <KpiCell label="Total users" value={String(totalUsers)} />
        <KpiCell label="Premium" value={`${premiumPct}%`} sub={`${premiumUsers} users`} />
        <KpiCell label="Today's AI spend" value={`$${todayDollars}`} />
        <KpiCell
          label="Errors today"
          value={String(errorsTodayCount)}
          tone={errorsTodayCount > 0 ? "warn" : "ok"}
        />
      </div>

      {/* ── Recent errors + today's signups, side by side ───────────────── */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              Recent errors
            </h3>
            <a
              href="#/admin/errors"
              className="text-[11px] text-primary font-medium hover:underline"
            >
              See all →
            </a>
          </div>
          {!errorsResp ? (
            <p className="text-xs text-muted-foreground italic py-2">Loading…</p>
          ) : errorsResp.errors.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2 text-center">
              All clear — nothing to review.
            </p>
          ) : (
            <div className="space-y-1.5">
              {errorsResp.errors.slice(0, 5).map((e) => (
                <div key={e.id} className="text-xs border-b border-border last:border-0 pb-1.5 last:pb-0">
                  <p className="font-medium truncate">{e.errorMessage || "(no message)"}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    <span className="font-mono">{fmtRelativeAgo(e.occurredAt)}</span>
                    <span> · </span>
                    <CopyableTime iso={e.occurredAt} />
                    {e.statusCode && <span> · HTTP {e.statusCode}</span>}
                    <span> · </span>
                    <span>{e.userEmail || "(anon)"}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-primary" />
              New today
            </h3>
            <span className="text-[10px] text-muted-foreground font-mono">
              {newSignupsToday.length} signup{newSignupsToday.length === 1 ? "" : "s"}
            </span>
          </div>
          {newSignupsToday.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2 text-center">
              No new signups yet today.
            </p>
          ) : (
            <div className="space-y-1.5">
              {newSignupsToday.slice(0, 5).map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-2 text-xs border-b border-border last:border-0 pb-1.5 last:pb-0"
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                    style={{ backgroundColor: AVATAR_COLORS[u.id.charCodeAt(0) % AVATAR_COLORS.length] }}
                  >
                    {u.name?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{u.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-primary" : "text-foreground";
  return (
    <div className="rounded-lg bg-muted/40 p-2.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className={`text-base font-semibold font-mono ${toneClass}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Time formatting helpers (shared between Home + Errors panels) ─────────
// fmtRelativeAgo: "3m ago" — at-a-glance recency
// fmtExactLocal:  "Jun 4, 14:32:18" — browser-local, for matching with PostHog
//                  session recordings (which display in viewer's local TZ)
function fmtRelativeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function fmtExactLocal(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// Clickable timestamp — click to copy the ISO string to clipboard. Lets the
// admin paste the exact timestamp into PostHog's time-range picker without
// having to retype seconds-level precision.
function CopyableTime({ iso }: { iso: string }) {
  const { toast } = useToast();
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!navigator.clipboard) {
      toast({ title: "Clipboard unavailable", description: "Use a modern browser", variant: "destructive" });
      return;
    }
    navigator.clipboard.writeText(iso).then(
      () => toast({ title: "Timestamp copied", description: iso }),
      () => toast({ title: "Copy failed", variant: "destructive" }),
    );
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="underline-offset-2 hover:underline hover:text-foreground transition-colors"
      title={`Click to copy ISO timestamp: ${iso}`}
    >
      {fmtExactLocal(iso)}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ClientErrorsPanel — last 100 customer-facing errors so you can see what
// users are hitting without them having to message you.
// Errors get logged automatically by the queryClient wrapper on any non-2xx
// response, plus window.onerror / unhandledrejection handlers in main.tsx.
// ───────────────────────────────────────────────────────────────────────────

interface ClientErrorRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  occurredAt: string;
  endpoint: string | null;
  statusCode: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  contextJson: string | null;
  url: string | null;
  userAgent: string | null;
  reviewedAt: string | null;
}

interface ClientErrorsResponse {
  errors: ClientErrorRow[];
  topToday: Array<{ message: string | null; endpoint: string | null; count: number }>;
}

function ClientErrorsPanel() {
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, refetch } = useQuery<ClientErrorsResponse>({
    queryKey: [`/api/admin/client-errors?all=${showAll ? "1" : "0"}`],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/admin/client-errors?all=${showAll ? "1" : "0"}`);
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const reviewOne = async (id: string) => {
    try {
      await apiRequest("POST", `/api/admin/client-errors/${id}/review`);
      refetch();
    } catch (err: any) {
      toast({ title: "Mark-reviewed failed", description: err?.message, variant: "destructive" });
    }
  };

  const reviewAll = async () => {
    try {
      const r = await apiRequest("POST", "/api/admin/client-errors/review-all");
      const json = await r.json();
      toast({ title: `Marked ${json.count ?? 0} errors as reviewed` });
      refetch();
    } catch (err: any) {
      toast({ title: "Failed to mark-all-reviewed", description: err?.message, variant: "destructive" });
    }
  };

  // Time formatting moved to module level (fmtRelativeAgo / fmtExactLocal /
  // CopyableTime) so the Home panel can reuse the same UX.

  if (isLoading) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="w-4 h-4" />
          Loading customer errors…
        </div>
      </Card>
    );
  }

  if (!data) return null;

  const total = data.errors.length;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-semibold">
            Customer-facing errors {showAll ? "(all)" : "(unreviewed)"}
            {total > 0 && <span className="text-muted-foreground font-normal ml-1">— {total}</span>}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show unreviewed" : "Show all"}
          </Button>
          {!showAll && total > 0 && (
            <Button size="sm" variant="outline" onClick={reviewAll}>
              Mark all reviewed
            </Button>
          )}
        </div>
      </div>

      {data.topToday.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 p-2.5 space-y-1">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-mono">
            Most common today
          </p>
          {data.topToday.slice(0, 5).map((t, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate flex-1 min-w-0">
                <span className="text-muted-foreground">{t.endpoint || "(no endpoint)"} ·</span>{" "}
                <span>{t.message || "(no message)"}</span>
              </span>
              <span className="shrink-0 font-mono text-muted-foreground">×{t.count}</span>
            </div>
          ))}
        </div>
      )}

      {total === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2 text-center">
          {showAll ? "No errors logged yet." : "Nothing to review — clean slate."}
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[480px] overflow-y-auto">
          {data.errors.map((e) => (
            <div
              key={e.id}
              className={`rounded-lg border p-2.5 space-y-1 text-xs ${
                e.reviewedAt ? "border-border bg-muted/20 opacity-60" : "border-amber-500/30 bg-amber-500/5"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-muted-foreground flex flex-wrap items-center gap-x-1">
                  <span>{fmtRelativeAgo(e.occurredAt)}</span>
                  <span>·</span>
                  <CopyableTime iso={e.occurredAt} />
                  {e.statusCode != null && <><span>·</span><span>HTTP {e.statusCode}</span></>}
                  {e.userEmail && <><span>·</span><span>{e.userEmail}</span></>}
                </span>
                {!e.reviewedAt && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => reviewOne(e.id)}>
                    Mark reviewed
                  </Button>
                )}
              </div>
              {e.endpoint && (
                <p className="font-mono text-[11px] text-muted-foreground truncate">{e.endpoint}</p>
              )}
              <p className="font-medium">{e.errorMessage || "(no message)"}</p>
              {e.url && (
                <p className="text-[10px] text-muted-foreground truncate">on {e.url}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
