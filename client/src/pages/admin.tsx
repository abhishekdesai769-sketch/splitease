import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { SafeUser } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, UserCheck, UserX, Trash2, RotateCcw, FolderX, ReceiptText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

export default function Admin() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: allUsers = [], isLoading } = useQuery<SafeUser[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: deletedData } = useQuery<{ groups: any[], expenses: any[] }>({ queryKey: ["/api/admin/deleted"] });

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

  const approveMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}/approve`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User approved" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}/revoke`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Access revoked" });
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

  const pendingUsers = allUsers.filter((u) => !u.isApproved && !u.isAdmin);
  const approvedUsers = allUsers.filter((u) => u.isApproved || u.isAdmin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage users and access control
        </p>
      </div>

      {/* Pending Approvals */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Pending Approval ({pendingUsers.length})
        </h2>
        {pendingUsers.length > 0 ? (
          <div className="space-y-2">
            {pendingUsers.map((u) => (
              <Card
                key={u.id}
                className="p-3 flex items-center gap-3 border-amber-500/30 bg-amber-500/5"
                data-testid={`pending-user-${u.id}`}
              >
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0"
                  style={{ backgroundColor: u.avatarColor }}
                >
                  {u.name[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{u.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => approveMutation.mutate(u.id)}
                  disabled={approveMutation.isPending}
                  data-testid={`approve-${u.id}`}
                >
                  <UserCheck className="w-4 h-4 mr-1" />
                  Approve
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Delete ${u.name}? This cannot be undone.`)) {
                      deleteMutation.mutate(u.id);
                    }
                  }}
                  data-testid={`delete-pending-${u.id}`}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-4 text-center">
            <p className="text-sm text-muted-foreground">No pending requests</p>
          </Card>
        )}
      </div>

      {/* Approved Users */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Active Users ({approvedUsers.length})
        </h2>
        <div className="space-y-2">
          {approvedUsers.map((u) => (
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
                </div>
                <p className="text-xs text-muted-foreground truncate">{u.email}</p>
              </div>
              {u.id !== user?.id && !u.isAdmin && (
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => revokeMutation.mutate(u.id)}
                    disabled={revokeMutation.isPending}
                    data-testid={`revoke-${u.id}`}
                  >
                    <UserX className="w-3.5 h-3.5 mr-1" />
                    Revoke
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Delete ${u.name}? This removes them and their friend links.`)) {
                        deleteMutation.mutate(u.id);
                      }
                    }}
                    data-testid={`delete-${u.id}`}
                  >
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {/* Deleted Items */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Deleted Items
        </h2>
        {(!deletedData || (deletedData.groups.length === 0 && deletedData.expenses.length === 0)) ? (
          <Card className="p-4 text-center">
            <p className="text-sm text-muted-foreground">No deleted items to restore</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {deletedData.groups.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  <FolderX className="w-3.5 h-3.5" />
                  Deleted Groups ({deletedData.groups.length})
                </h3>
                <div className="space-y-2">
                  {deletedData.groups.map((g: any) => (
                    <Card key={g.id} className="p-3 flex items-center gap-3 border-destructive/20 bg-destructive/5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{g.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Deleted {g.deletedAt ? new Date(g.deletedAt).toLocaleDateString() : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => restoreGroupMutation.mutate(g.id)}
                        disabled={restoreGroupMutation.isPending}
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        Restore
                      </Button>
                    </Card>
                  ))}
                </div>
              </div>
            )}
            {deletedData.expenses.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                  <ReceiptText className="w-3.5 h-3.5" />
                  Deleted Expenses ({deletedData.expenses.length})
                </h3>
                <div className="space-y-2">
                  {deletedData.expenses.map((e: any) => (
                    <Card key={e.id} className="p-3 flex items-center gap-3 border-destructive/20 bg-destructive/5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{e.description}</p>
                        <p className="text-xs text-muted-foreground">
                          ${e.amount?.toFixed(2)} · Deleted {e.deletedAt ? new Date(e.deletedAt).toLocaleDateString() : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => restoreExpenseMutation.mutate(e.id)}
                        disabled={restoreExpenseMutation.isPending}
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        Restore
                      </Button>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
