// PlaidLinkButton — opens Plaid's bank-connection UI in a modal sheet.
//
// Flow:
//   1. Tap button → POST /api/money/plaid-link-token → get link_token
//   2. usePlaidLink({ token, onSuccess }) opens Plaid's hosted UI
//   3. User picks bank, logs in, MFA — all inside Plaid's UI (we never see creds)
//   4. On success: Plaid hands us a one-time public_token + metadata
//   5. POST /api/money/plaid-exchange → server stores access_token + accounts
//   6. We invalidate the /api/money/accounts query so the list refreshes
//
// Failure modes:
//   - Plaid not configured server-side → 503 → render disabled button + reason
//   - Link token call fails → toast error, button stays clickable
//   - User cancels in Plaid UI → onExit, no-op, no toast
//   - Exchange fails → toast with the server's message

import { useState, useCallback, useEffect } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { Button } from "@/components/ui/button";
import { Loader2, Building2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface PlaidLinkButtonProps {
  /** Called after a successful connect — useful for analytics or refresh hooks. */
  onConnected?: (institutionName: string | null, accountCount: number) => void;
  /** Visual style — "primary" for the main CTA, "secondary" for "Connect another". */
  variant?: "primary" | "secondary";
}

export function PlaidLinkButton({ onConnected, variant = "primary" }: PlaidLinkButtonProps) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch a Link token. Tokens are short-lived (~4 hours) so we fetch on tap,
  // not on mount — avoids burning tokens for users who never click.
  const fetchLinkToken = useCallback(async () => {
    setIsLoading(true);
    setServerError(null);
    try {
      const res = await apiRequest("POST", "/api/money/plaid-link-token", {});
      const data = await res.json();
      setLinkToken(data.link_token);
    } catch (err: any) {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": "))?.message || msg; } catch {}
      if (err.message?.includes("503")) {
        setServerError("Bank connections aren't live yet — coming soon.");
      } else {
        toast({ title: "Couldn't open bank connection", description: msg, variant: "destructive" });
      }
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  // Plaid Link hook — opens the UI when ready=true and we call open().
  const onSuccess = useCallback(async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
    try {
      const res = await apiRequest("POST", "/api/money/plaid-exchange", {
        public_token: publicToken,
        // Optional metadata for analytics / debugging — server ignores extras
        institution_id: metadata.institution?.institution_id,
        institution_name: metadata.institution?.name,
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/money/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/money/status"] });
      toast({
        title: "Bank connected",
        description: `${data.item?.institutionName || metadata.institution?.name || "Account"} — ${data.item?.accountCount ?? metadata.accounts.length} account${(data.item?.accountCount ?? metadata.accounts.length) !== 1 ? "s" : ""} linked.`,
      });
      onConnected?.(data.item?.institutionName ?? metadata.institution?.name ?? null, data.item?.accountCount ?? metadata.accounts.length);
    } catch (err: any) {
      let msg = err.message;
      try { msg = JSON.parse(msg.split(": ").slice(1).join(": "))?.message || msg; } catch {}
      toast({ title: "Couldn't finish connecting", description: msg, variant: "destructive" });
    } finally {
      // Reset the token so a future tap fetches a fresh one
      setLinkToken(null);
    }
  }, [queryClient, toast, onConnected]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => {
      // User cancelled — no-op, no toast. Reset token so next tap is fresh.
      setLinkToken(null);
    },
  });

  // Auto-open Plaid Link the moment the token + ready handshake completes.
  // This is the canonical pattern from Plaid's React docs — without it, the
  // user would have to tap again after the token fetch resolves.
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  if (serverError) {
    return (
      <Button type="button" variant="outline" disabled className="w-full">
        <Building2 className="w-4 h-4 mr-2 opacity-50" />
        {serverError}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      onClick={fetchLinkToken}
      disabled={isLoading || (!!linkToken && !ready)}
      variant={variant === "primary" ? "default" : "outline"}
      className="w-full"
    >
      {isLoading || (!!linkToken && !ready) ? (
        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Opening Plaid…</>
      ) : (
        <><Building2 className="w-4 h-4 mr-2" /> {variant === "primary" ? "Connect a bank" : "Connect another bank"}</>
      )}
    </Button>
  );
}
