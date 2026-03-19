import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Person, Expense } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserPlus, Trash2, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { calculateGroupBalances } from "@/lib/simplify";

const AVATAR_COLORS = [
  "#0d9488", "#0891b2", "#7c3aed", "#db2777", "#ea580c",
  "#d97706", "#059669", "#4f46e5", "#be185d", "#2563eb",
];

function getRandomColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function Avatar({ name, color }: { name: string; color: string }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
      style={{ backgroundColor: color }}
    >
      {initials}
    </div>
  );
}

export default function Friends() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const { data: people = [] } = useQuery<Person[]>({ queryKey: ["/api/people"] });
  const { data: expenses = [] } = useQuery<Expense[]>({ queryKey: ["/api/expenses"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/people", {
        name: name.trim(),
        email: email.trim() || null,
        avatarColor: getRandomColor(),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      setName("");
      setEmail("");
      setOpen(false);
      toast({ title: "Friend added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/people/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/people"] });
      toast({ title: "Friend removed" });
    },
  });

  // Calculate what each friend owes/is owed from direct expenses
  const directExpenses = expenses.filter((e) => !e.groupId);
  const friendBalances = calculateGroupBalances(directExpenses);
  const getBalance = (personId: string) => {
    const b = friendBalances.find((b) => b.personId === personId);
    return b ? b.amount : 0;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Friends</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{people.length} friends added</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="add-friend-btn">
              <UserPlus className="w-4 h-4 mr-1.5" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a Friend</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) createMutation.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="friend-name">Name</Label>
                <Input
                  id="friend-name"
                  placeholder="e.g. John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="input-friend-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="friend-email">Email (optional)</Label>
                <Input
                  id="friend-email"
                  type="email"
                  placeholder="john@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-friend-email"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!name.trim() || createMutation.isPending}
                data-testid="submit-friend"
              >
                {createMutation.isPending ? "Adding..." : "Add Friend"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {people.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <h3 className="text-base font-semibold mb-1">No friends yet</h3>
          <p className="text-sm text-muted-foreground">
            Add friends to start splitting expenses with them.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {people.map((person) => {
            const balance = getBalance(person.id);
            return (
              <Card key={person.id} className="p-3 flex items-center gap-3" data-testid={`friend-card-${person.id}`}>
                <Avatar name={person.name} color={person.avatarColor} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{person.name}</p>
                  {person.email && (
                    <p className="text-xs text-muted-foreground truncate">{person.email}</p>
                  )}
                </div>
                {balance !== 0 && (
                  <span
                    className={`text-sm font-semibold shrink-0 ${
                      balance > 0 ? "text-primary" : "text-destructive"
                    }`}
                  >
                    {balance > 0 ? "+" : ""}${balance.toFixed(2)}
                  </span>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => deleteMutation.mutate(person.id)}
                  data-testid={`delete-friend-${person.id}`}
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
