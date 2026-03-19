import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Group, Expense } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FolderPlus, UsersRound, Trash2, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";

export default function Groups() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [groupName, setGroupName] = useState("");

  const { data: groups = [] } = useQuery<Group[]>({ queryKey: ["/api/groups"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/groups", {
        name: groupName.trim(),
        memberIds: [], // creator is added automatically on server
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setGroupName("");
      setOpen(false);
      toast({ title: "Group created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
      toast({ title: "Group deleted" });
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const getGroupExpenseCount = (groupId: string) =>
    expenses.filter((e) => e.groupId === groupId).length;

  const getGroupTotal = (groupId: string) =>
    expenses.filter((e) => e.groupId === groupId).reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Groups</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{groups.length} groups</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="create-group-btn">
              <FolderPlus className="w-4 h-4 mr-1.5" />
              Create
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a Group</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (groupName.trim()) createMutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="group-name">Group Name</Label>
                <Input
                  id="group-name"
                  placeholder="e.g. Road Trip 2026"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  data-testid="input-group-name"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                You'll be added as a member automatically. You can invite friends by email after creating the group.
              </p>
              <Button
                type="submit"
                className="w-full"
                disabled={!groupName.trim() || createMutation.isPending}
                data-testid="submit-group"
              >
                {createMutation.isPending ? "Creating..." : "Create Group"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {groups.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <UsersRound className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold mb-1">No groups yet</h3>
          <p className="text-sm text-muted-foreground">
            Create a group and invite your friends to start splitting expenses.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const expenseCount = getGroupExpenseCount(group.id);
            const total = getGroupTotal(group.id);
            return (
              <Link key={group.id} href={`/groups/${group.id}`}>
                <Card className="p-3 flex items-center gap-3 hover-elevate cursor-pointer" data-testid={`group-card-${group.id}`}>
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <UsersRound className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{group.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.memberIds.length} members · {expenseCount} expenses
                    </p>
                  </div>
                  {total > 0 && (
                    <span className="text-sm font-semibold text-primary shrink-0">
                      ${total.toFixed(2)}
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    {group.createdById === user?.id && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteMutation.mutate(group.id);
                        }}
                        data-testid={`delete-group-${group.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    )}
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
