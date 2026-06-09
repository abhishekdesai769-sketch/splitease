/**
 * PaymentMethods — "how I want to get paid back."
 *
 * Two exports:
 *   - PaymentMethodsEditor: set YOUR OWN methods + note (used in the menu →
 *     "How I get paid"). Fetches + saves via /api/user/payment-methods.
 *   - PaymentMethodsView: read-only display of SOMEONE ELSE's methods with
 *     copy-to-clipboard buttons (used in Settle Up + group-member tap).
 *     Fetches /api/users/:id/payment-info (server-gated to friends/groups).
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, X, Copy, Check, Loader2, Wallet } from "lucide-react";
import {
  PAYMENT_METHOD_TYPES,
  MAX_PAYMENT_METHODS,
  MAX_PAYMENT_NOTE_LEN,
  paymentMethodLabel,
  type PaymentMethod,
} from "@shared/payment-methods";

// ─── Editor (your own) ─────────────────────────────────────────────────────

export function PaymentMethodsEditor({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest("GET", "/api/user/payment-methods")
      .then((r) => r.json())
      .then((data) => {
        setMethods(Array.isArray(data.methods) ? data.methods : []);
        setNote(data.note || "");
      })
      .catch(() => { /* start empty */ })
      .finally(() => setLoading(false));
  }, []);

  const addMethod = () => {
    if (methods.length >= MAX_PAYMENT_METHODS) return;
    setMethods((prev) => [...prev, { type: "interac", value: "" }]);
  };
  const updateMethod = (i: number, patch: Partial<PaymentMethod>) => {
    setMethods((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  };
  const removeMethod = (i: number) => {
    setMethods((prev) => prev.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    setSaving(true);
    try {
      // Drop blank-value rows before saving (server also sanitizes).
      const clean = methods.filter((m) => m.value.trim().length > 0);
      const r = await apiRequest("PATCH", "/api/user/payment-methods", {
        methods: clean,
        note: note.trim(),
      });
      const data = await r.json();
      setMethods(data.methods || []);
      setNote(data.note || "");
      toast({ title: "Saved", description: "Your payment info is updated." });
      onBack();
    } catch (err: any) {
      toast({ title: "Couldn't save", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col px-5 overflow-y-auto pb-6">
      <button
        onClick={onBack}
        className="text-xs text-muted-foreground hover:text-foreground mb-3 self-start flex-shrink-0"
      >
        ← Back
      </button>

      <h3 className="text-sm font-semibold mb-1 flex-shrink-0">How I get paid</h3>
      <p className="text-xs text-muted-foreground mb-5 flex-shrink-0 leading-relaxed">
        Add how you'd like to be paid back. Your friends and group members see this
        when they settle up with you — so they know exactly where to send the money.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {methods.map((m, i) => {
              const typeMeta = PAYMENT_METHOD_TYPES.find((t) => t.id === m.type);
              return (
                <div key={i} className="rounded-lg border border-border p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={m.type}
                      onChange={(e) => updateMethod(i, { type: e.target.value })}
                      className="flex-1 h-9 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {PAYMENT_METHOD_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeMethod(i)}
                      className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted/40"
                      aria-label="Remove"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <Input
                    value={m.value}
                    onChange={(e) => updateMethod(i, { value: e.target.value })}
                    placeholder={typeMeta?.valueHint || "details"}
                    className="h-9 text-sm"
                    maxLength={120}
                  />
                </div>
              );
            })}
          </div>

          {methods.length < MAX_PAYMENT_METHODS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addMethod}
              className="mt-2.5 self-start"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add payment method
            </Button>
          )}

          {/* Free-text catch-all note */}
          <div className="mt-5">
            <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
              Anything else? (optional)
            </p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_PAYMENT_NOTE_LEN))}
              placeholder="e.g. cash is fine too, or add a note when sending so I know it's you"
              rows={2}
              className="resize-none text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-1 text-right">
              {note.length}/{MAX_PAYMENT_NOTE_LEN}
            </p>
          </div>

          <Button onClick={save} disabled={saving} className="mt-4">
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            Save
          </Button>
        </>
      )}
    </div>
  );
}

// ─── Viewer (someone else's) ───────────────────────────────────────────────

interface PaymentInfoResponse {
  name: string;
  methods: PaymentMethod[];
  note: string;
}

/**
 * Read-only display of another user's payment info. Fetches the gated
 * endpoint; renders nothing (or a tiny empty line) if they haven't set any.
 * `compact` trims the padding for inline use inside dialogs.
 */
export function PaymentMethodsView({
  userId,
  name,
  compact = false,
}: {
  userId: string;
  name?: string;
  compact?: boolean;
}) {
  const { data, isLoading } = useQuery<PaymentInfoResponse>({
    queryKey: [`/api/users/${userId}/payment-info`],
    queryFn: async () => (await apiRequest("GET", `/api/users/${userId}/payment-info`)).json(),
    enabled: !!userId,
    staleTime: 60_000,
    retry: false,
  });

  const displayName = name || data?.name || "They";
  const hasAny = data && (data.methods.length > 0 || data.note.trim().length > 0);

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 text-xs text-muted-foreground ${compact ? "" : "py-2"}`}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading payment info…
      </div>
    );
  }

  if (!hasAny) {
    return (
      <p className="text-xs text-muted-foreground italic">
        {displayName} hasn't added payment info yet.
      </p>
    );
  }

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <p className="text-[11px] uppercase tracking-wider font-mono text-muted-foreground flex items-center gap-1">
        <Wallet className="w-3 h-3" /> How {displayName} gets paid
      </p>
      {data!.methods.map((m, i) => (
        <PaymentMethodRow key={i} method={m} />
      ))}
      {data!.note.trim().length > 0 && (
        <p className="text-xs text-muted-foreground leading-relaxed pt-0.5">
          “{data!.note}”
        </p>
      )}
    </div>
  );
}

function PaymentMethodRow({ method }: { method: PaymentMethod }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!navigator.clipboard) {
      toast({ title: "Clipboard unavailable", variant: "destructive" });
      return;
    }
    navigator.clipboard.writeText(method.value).then(() => {
      setCopied(true);
      toast({ title: "Copied", description: method.value });
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{paymentMethodLabel(method.type)}</p>
        <p className="text-sm font-medium truncate">{method.value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 inline-flex items-center gap-1 text-xs text-primary font-medium px-2 py-1 rounded-md hover:bg-primary/10"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
