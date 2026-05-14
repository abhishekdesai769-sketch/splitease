import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Users, AlertCircle } from "lucide-react";
import { track } from "@/lib/analytics";

interface InvitePreview {
  groupName: string;
  memberCount: number;
  expiresAt: string;
}

/**
 * Public invite page (V1).
 *
 * Behavior:
 * - Anyone (logged in or out) can view the preview at #/invite/:code
 * - Logged-in users see "Join group" → POST /api/invite/:code/accept → redirect to /groups/:id
 * - Logged-out users see "Sign up to join" → stash the code in localStorage,
 *   send them through AuthPage. After signup completes, App.tsx detects the pending
 *   code and bounces them back to #/invite/:code so they can complete the join.
 */
export default function InvitePage() {
  const [, params] = useRoute("/invite/:code");
  const code = params?.code;
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: preview, error, isLoading } = useQuery<InvitePreview>({
    queryKey: [`/api/invite/${code}`],
    enabled: !!code,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/invite/${code}/accept`);
      return res.json();
    },
    onSuccess: (data: { groupId: string; alreadyMember: boolean }) => {
      localStorage.removeItem("spliiit_pending_invite");
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      queryClient.invalidateQueries({ queryKey: [`/api/groups/${data.groupId}`] });
      // Track the join — this closes the loop from first_invite_sent and is the
      // key signal for the new AARRR activation event in PostHog.
      if (!data.alreadyMember) {
        track("group_invite_accepted", {
          groupId: data.groupId,
          groupName: preview?.groupName,
        });
      }
      toast({
        title: data.alreadyMember ? "You're already in this group" : `Joined ${preview?.groupName}!`,
        description: data.alreadyMember
          ? "Taking you to the group."
          : "Welcome aboard.",
      });
      setLocation(`/groups/${data.groupId}`);
    },
    onError: (err: Error) => {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": ")).error; } catch {}
      toast({ title: "Couldn't join group", description: msg, variant: "destructive" });
    },
  });

  const handleSignUpToJoin = () => {
    if (!code) return;
    localStorage.setItem("spliiit_pending_invite", code);
    // Setting the hash to root makes App.tsx render the AuthPage (since !user).
    // After signup, App.tsx will detect the pending invite and route back here.
    window.location.hash = "#/";
  };

  if (!code) {
    return <ErrorCard title="Invalid invite link" message="The link is missing a code." />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !preview) {
    const raw = (error as Error)?.message || "";
    let title = "Invite link not found";
    let description = "Double-check the link or ask whoever sent it for a new one.";
    if (raw.includes("410") && raw.toLowerCase().includes("revoked")) {
      title = "Link revoked";
      description = "This invite link has been revoked. Ask the group for a new one.";
    } else if (raw.includes("410") && raw.toLowerCase().includes("expired")) {
      title = "Link expired";
      description = "This invite link is older than 7 days. Ask the group for a new one.";
    }
    return <ErrorCard title={title} message={description} />;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-8 space-y-6" data-testid="invite-preview-card">
        <div className="space-y-3 text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 mx-auto flex items-center justify-center">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">You're invited to join</p>
          <h1 className="text-2xl font-bold" data-testid="invite-group-name">{preview.groupName}</h1>
          <p className="text-sm text-muted-foreground">
            {preview.memberCount} {preview.memberCount === 1 ? "member" : "members"} already in this group
          </p>
        </div>

        {user ? (
          <Button
            className="w-full"
            size="lg"
            onClick={() => acceptMutation.mutate()}
            disabled={acceptMutation.isPending}
            data-testid="btn-join-group"
          >
            {acceptMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Joining...</>
            ) : (
              "Join group"
            )}
          </Button>
        ) : (
          <div className="space-y-3">
            <Button
              className="w-full"
              size="lg"
              onClick={handleSignUpToJoin}
              data-testid="btn-signup-to-join"
            >
              Sign up to join
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Free to join · No credit card required
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center pt-2 border-t border-border">
          Spliiit · Free expense splitting for groups
        </p>
      </Card>
    </div>
  );
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-8 space-y-6 text-center" data-testid="invite-error-card">
        <div className="w-12 h-12 rounded-full bg-destructive/10 mx-auto flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-destructive" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => setLocation("/")}>
          Go to Spliiit
        </Button>
      </Card>
    </div>
  );
}
