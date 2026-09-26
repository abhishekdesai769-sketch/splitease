import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, Plus, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ShareChannels } from "@/components/ShareChannels";
import {
  PAYMENT_METHOD_TYPES,
  MAX_PAYMENT_METHODS,
  MAX_PAYMENT_NOTE_LEN,
  paymentMethodLabel,
  type PaymentMethod,
} from "@shared/payment-methods";

// The screens behind each menu row, in the drawer's design language:
// serif title, paper groups on beige, ink primary buttons, no hairlines.
// Mirrors the Spliiit prototype (Sept 2026).

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  try { return JSON.parse(msg.split(": ").slice(1).join(": ")).error || msg; } catch { return msg; }
}

const FIELD = "w-full rounded-[14px] bg-muted/50 px-3.5 py-3 text-[15px] text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
const INK_BUTTON = "rounded-full bg-foreground text-background text-sm font-medium px-5 py-3 disabled:opacity-40";

function Screen({ onBack, backLabel = "Menu", title, intro, children, testId }: {
  onBack: () => void; backLabel?: string; title: string; intro?: ReactNode; children: ReactNode; testId: string;
}) {
  return (
    <div className="flex-1 flex flex-col px-4 pt-3 pb-6 overflow-y-auto" data-testid={testId}>
      <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground self-start px-1 py-2.5 mb-1">
        ← {backLabel}
      </button>
      <h3 className="font-serif text-[36px] leading-none text-foreground px-1 mb-2">{title}</h3>
      {intro && <p className="text-sm leading-relaxed text-muted-foreground px-1 mb-5">{intro}</p>}
      {!intro && <div className="mb-3" />}
      {children}
    </div>
  );
}

function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  const cls = "block text-[11px] uppercase tracking-[0.08em] text-muted-foreground px-3.5 pb-2";
  return htmlFor ? <label htmlFor={htmlFor} className={cls}>{children}</label> : <p className={cls}>{children}</p>;
}

// ─── How I get paid ────────────────────────────────────────────────────────

export function PaymentScreen({ onBack }: { onBack: () => void }) {
  const { toast } = useToast();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState(PAYMENT_METHOD_TYPES[0].id);
  const [addValue, setAddValue] = useState("");
  const [addError, setAddError] = useState("");

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

  const addHint = PAYMENT_METHOD_TYPES.find((t) => t.id === addType)?.valueHint || "details";

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const value = addValue.trim();
    if (!value && addType !== "cash") { setAddError("Add the details people need to pay you."); return; }
    setMethods((prev) => [...prev, { type: addType, value: value || "In person" }]);
    setAdding(false);
    setAddValue("");
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await apiRequest("PATCH", "/api/user/payment-methods", {
        methods: methods.filter((m) => m.value.trim().length > 0),
        note: note.trim(),
      });
      const data = await r.json();
      setMethods(data.methods || []);
      setNote(data.note || "");
      toast({ title: "Saved" });
    } catch (err) {
      toast({ title: "Couldn't save", description: errorText(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen onBack={onBack} title="How I get paid" intro="Friends and people in your groups see this when they settle up with you." testId="screen-payment">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground px-2 py-6">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <Label>Ways to pay me</Label>
          <div className="rounded-[22px] bg-card p-1 mb-4">
            {methods.map((m, i) => (
              <div key={`${m.type}-${i}`} className="flex items-center gap-2 pl-3.5 pr-1.5 py-2 min-h-[52px]">
                <span className="flex-1 min-w-0">
                  <span className="block text-xs text-muted-foreground">{paymentMethodLabel(m.type)}</span>
                  <span className="block text-[15px] text-foreground truncate">{m.value}</span>
                </span>
                <button
                  onClick={() => setMethods((prev) => prev.filter((_, idx) => idx !== i))}
                  className="w-10 h-10 rounded-full flex items-center justify-center text-foreground/35 hover:text-foreground"
                  aria-label={`Remove ${paymentMethodLabel(m.type)}`}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            {methods.length < MAX_PAYMENT_METHODS && !adding && (
              <button
                onClick={() => { setAdding(true); setAddValue(""); setAddError(""); }}
                className="w-full flex items-center gap-3 px-3.5 py-3 min-h-[48px] rounded-[18px] text-left text-[15px] text-accent-foreground"
                data-testid="payment-add"
              >
                <Plus className="w-5 h-5" /> Add a way to get paid
              </button>
            )}
          </div>

          {adding && (
            <form onSubmit={submitAdd} className="rounded-[22px] bg-card p-3 mb-4">
              <label htmlFor="pay-type" className="block text-xs text-muted-foreground mb-1.5 ml-0.5">Method</label>
              <select id="pay-type" value={addType} onChange={(e) => setAddType(e.target.value)} className={`${FIELD} appearance-none mb-3`}>
                {PAYMENT_METHOD_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <label htmlFor="pay-value" className="block text-xs text-muted-foreground mb-1.5 ml-0.5">Details</label>
              <input
                id="pay-value"
                value={addValue}
                onChange={(e) => { setAddValue(e.target.value); setAddError(""); }}
                placeholder={addHint}
                maxLength={120}
                autoComplete="off"
                autoFocus
                className={FIELD}
              />
              {addError && <p className="text-[13px] text-destructive mt-1.5 ml-0.5">{addError}</p>}
              <div className="flex justify-end gap-2 mt-3">
                <button type="button" onClick={() => setAdding(false)} className="text-[13px] text-muted-foreground px-3 py-2">Cancel</button>
                <button type="submit" className="rounded-full bg-foreground text-background text-[13px] font-medium px-4 py-2">Add</button>
              </div>
            </form>
          )}

          <Label htmlFor="pay-note">Note for people paying you</Label>
          <div className="rounded-[22px] bg-card p-3 mb-5">
            <textarea
              id="pay-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, MAX_PAYMENT_NOTE_LEN))}
              placeholder="Cash is fine too, or add a note when sending so I know it's you"
              rows={3}
              className={`${FIELD} resize-none leading-snug`}
            />
            <p className="text-[11px] text-muted-foreground text-right mt-1.5 mr-1">{note.length}/{MAX_PAYMENT_NOTE_LEN}</p>
          </div>

          <button onClick={save} disabled={saving} className={INK_BUTTON} data-testid="payment-save">
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      )}
    </Screen>
  );
}

// ─── Auto reminders ────────────────────────────────────────────────────────

type ReminderTone = "friendly" | "funny" | "firm" | "passive-aggressive" | "awkward";
type ReminderSettings = { reminderEnabled: boolean; reminderDays: number; reminderTone: ReminderTone };

const TONES: { id: ReminderTone; name: string; sub: string }[] = [
  { id: "friendly", name: "Friendly", sub: "Warm and casual" },
  { id: "funny", name: "Funny", sub: "Light humour" },
  { id: "firm", name: "Firm", sub: "Professional" },
  { id: "passive-aggressive", name: "Passive-aggressive", sub: "Polite but pointed" },
  { id: "awkward", name: "Awkward", sub: "Cringe energy" },
];

// Same copy the scheduler's email uses (server/email.ts sendAutoReminderEmail).
function emailPreview(tone: ReminderTone, ownerName: string): { subject: string; body: string } {
  const debtor = "Jamie";
  const amt = "$42.00";
  const subjects: Record<ReminderTone, string> = {
    friendly: `👋 Friendly nudge from Spliiit — you owe ${ownerName} money`,
    funny: `Fun fact: you owe ${ownerName} ${amt} 😄`,
    firm: `Payment reminder: you have an outstanding balance with ${ownerName}`,
    "passive-aggressive": `No worries at all! Just a tiny lil reminder 🙂`,
    awkward: `We really didn't want to send this, but... 😬`,
  };
  const bodies: Record<ReminderTone, string> = {
    friendly: `Hey ${debtor}! 👋\n\nSpliiit here — just a quick, friendly nudge that you have an outstanding balance of ${amt} with ${ownerName} on the app.\n\nNo stress at all, but whenever you get a chance to settle up it would mean a lot! Tap the button below to sort it out in seconds.\n\n— Spliiit`,
    funny: `Hi ${debtor} 😄\n\nFun fact: you owe ${ownerName} ${amt}. Less fun fact: it's been sitting there for a while. Even less fun fact: Spliiit just sent you this email about it.\n\nGood news though — settling up takes about 10 seconds flat. Then we can all move on with our lives. Deal?\n\n— Spliiit`,
    firm: `Hi ${debtor},\n\nThis is an automated reminder from Spliiit that you have an outstanding balance of ${amt} owed to ${ownerName}.\n\nPlease settle this at your earliest convenience using the button below.\n\nThank you,\nSpliiit`,
    "passive-aggressive": `Hi ${debtor},\n\nNo worries at all! Totally fine! Just wanted to pop in and gently, warmly, completely-non-aggressively mention that you still owe ${ownerName} ${amt}. No rush whatsoever. We're sure you've just been super busy. Completely understandable. 😊\n\nThe "Settle Up" button is right there whenever you're ready. Take your time. We'll wait.\n\n— Spliiit 🙂`,
    awkward: `Hey ${debtor}... we genuinely debated whether to send this. Like, a lot.\n\nBut here's the thing — you still owe ${ownerName} ${amt} and it's gotten to the point where NOT saying something is somehow weirder than saying something. So. We said something.\n\nPlease click the button. For everyone's sake.\n\n— Spliiit (this was hard for us too) 🙈`,
  };
  return { subject: subjects[tone], body: bodies[tone] };
}

export function RemindersScreen({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const KEY = ["/api/reminder-settings"];
  const { data } = useQuery<ReminderSettings>({
    queryKey: KEY,
    queryFn: async () => (await apiRequest("GET", "/api/reminder-settings")).json(),
  });
  const settings: ReminderSettings = {
    reminderEnabled: data?.reminderEnabled ?? false,
    reminderDays: data?.reminderDays ?? 7,
    reminderTone: (data?.reminderTone as ReminderTone) ?? "friendly",
  };

  // Saves on every change (like Notifications). Optimistic, rolls back on error.
  const save = useMutation({
    mutationFn: async (next: ReminderSettings) => (await apiRequest("PATCH", "/api/reminder-settings", next)).json(),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<ReminderSettings>(KEY);
      qc.setQueryData(KEY, next);
      return { previous };
    },
    onError: (err, _next, ctx) => {
      if (ctx?.previous) qc.setQueryData(KEY, ctx.previous);
      toast({ title: "Couldn't save", description: errorText(err), variant: "destructive" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const update = (patch: Partial<ReminderSettings>) => save.mutate({ ...settings, ...patch });

  const firstName = (user?.name || "You").split(" ")[0];
  const preview = emailPreview(settings.reminderTone, firstName);

  return (
    <Screen onBack={onBack} title="Auto reminders" intro="Spliiit emails people who owe you, from Spliiit's address, not yours." testId="screen-reminders">
      <div className="rounded-[22px] bg-card p-1 mb-4">
        <label htmlFor="reminders-on" className="flex items-center gap-3 px-3.5 py-3 min-h-[52px] cursor-pointer">
          <span className="flex-1">
            <span className="block text-[15px] text-foreground">Send auto reminders</span>
            <span className="block text-xs text-muted-foreground">Only to people with an open balance</span>
          </span>
          <Switch id="reminders-on" checked={settings.reminderEnabled} onCheckedChange={(v) => update({ reminderEnabled: v })} />
        </label>
      </div>

      <div className={settings.reminderEnabled ? "" : "opacity-50"}>
        <Label>Send after</Label>
        <div className="grid grid-cols-3 gap-1 rounded-full bg-card p-1 mb-5" role="group" aria-label="Send after">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              aria-pressed={settings.reminderDays === d}
              onClick={() => update({ reminderDays: d })}
              className={`rounded-full py-2.5 text-sm ${settings.reminderDays === d ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >
              {d} days
            </button>
          ))}
        </div>

        <Label>Tone</Label>
        <div className="rounded-[22px] bg-card p-1 mb-5" role="radiogroup" aria-label="Tone">
          {TONES.map((t) => {
            const on = settings.reminderTone === t.id;
            return (
              <button
                key={t.id}
                role="radio"
                aria-checked={on}
                onClick={() => update({ reminderTone: t.id })}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 min-h-[50px] rounded-[18px] text-left"
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${on ? "bg-foreground" : "ring-[1.5px] ring-inset ring-foreground/25"}`}>
                  {on && <span className="w-2 h-2 rounded-full bg-background" />}
                </span>
                <span className="flex-1">
                  <span className="block text-[15px] text-foreground">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">{t.sub}</span>
                </span>
              </button>
            );
          })}
        </div>

        <Label>Preview</Label>
        <div className="rounded-[22px] bg-card px-[18px] py-4">
          <p className="text-xs text-muted-foreground">From Spliiit · to Jamie, who owes you $42.00</p>
          <p className="text-[15px] font-medium text-foreground leading-snug mt-1 mb-3">{preview.subject}</p>
          <p className="text-[13.5px] leading-relaxed text-foreground/80 whitespace-pre-line">{preview.body}</p>
        </div>
      </div>
    </Screen>
  );
}

// ─── FAQs ──────────────────────────────────────────────────────────────────

const FAQ: { group: string; items: { q: string; a: string }[] }[] = [
  { group: "Adding expenses", items: [
    { q: "How do I add an expense with a friend?", a: "Go to the Friends tab, tap your friend, then tap + Expense at the top right. Enter what it was for, the amount, who paid, and how to split it. You can also just type or say it in the bar at the bottom of the home screen." },
    { q: "How do I add an expense in a group?", a: "Open the group from the Groups tab and tap + Add Expense. Fill in what it was for, the amount, who paid, and how to split it: equally, by percentage, or custom amounts." },
    { q: "What's the difference between groups and friends?", a: "Groups are for costs shared by three or more people, like roommates or a trip. Friends are for costs between just you and one other person. Both keep track of who owes whom." },
    { q: "How do I delete an expense?", a: "Open the group or friend, then tap the trash icon next to the expense. You can only delete expenses you added. Everyone else on it gets a notification." },
  ]},
  { group: "Settling up", items: [
    { q: "How do I settle up with someone?", a: "On a friend's page or a group page, tap Settle Up when there's a balance. It records the payment and brings the balance back to zero. Add how you want to be paid under How I get paid so people know where to send money." },
    { q: "How do I export my expenses?", a: "On a friend or group page, tap Export expenses to get that one. To get everything, open the menu, tap your name, then Export all my data. The spreadsheet is emailed to you." },
  ]},
  { group: "Inviting and importing", items: [
    { q: "How do I invite someone?", a: "Tap Invite a friend in the menu and share your link by WhatsApp, Messages, email or anywhere else. Adding someone to a group by email also sends them an invite." },
    { q: "What is a ghost member?", a: "A placeholder for someone who hasn't joined Spliiit yet. Their share is tracked, and they get an email inviting them to claim their account." },
    { q: "How do I import from Splitwise?", a: "In Splitwise, export a group as a CSV file. In Spliiit, open the menu, tap Import from Splitwise, upload the file and match the names to your people." },
    { q: "Can I import expenses with one friend?", a: "Yes. Open the friend, tap the three-dot menu next to their name, then Import from another app, and upload your Splitwise CSV." },
  ]},
  { group: "Privacy and your account", items: [
    { q: "Are receipt photos stored?", a: "No. When you attach a receipt, it's emailed to everyone on the split and isn't saved in Spliiit." },
    { q: "Is there a limit on expenses or receipts?", a: "No. You can add as many expenses and receipt photos as you like, every day, for free." },
    { q: "How do I change what Spliiit notifies me about?", a: "Open the menu and tap Notifications. Each kind of message has its own switch." },
    { q: "How do I delete my account?", a: "Open the menu, tap your name, then Delete account at the bottom. You'll confirm twice. Everything is removed for good." },
  ]},
];

export function FaqScreen({ onBack, onSupport }: { onBack: () => void; onSupport: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <Screen onBack={onBack} title="FAQs" testId="screen-faq">
      {FAQ.map((g) => (
        <div key={g.group} className="mb-4">
          <Label>{g.group}</Label>
          <div className="rounded-[22px] bg-card p-1">
            {g.items.map((item) => {
              const key = `${g.group}:${item.q}`;
              const open = openKey === key;
              const id = `faq-${key.replace(/[^a-z0-9]+/gi, "-")}`;
              return (
                <div key={key}>
                  <button
                    onClick={() => setOpenKey(open ? null : key)}
                    aria-expanded={open}
                    aria-controls={id}
                    className="w-full flex items-center gap-2.5 px-3.5 py-3 min-h-[48px] text-left text-[15px] leading-snug text-foreground"
                  >
                    <span className="flex-1">{item.q}</span>
                    <ChevronDown className={`w-4 h-4 text-foreground/35 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && <p id={id} className="px-3.5 pb-3.5 text-sm leading-relaxed text-foreground/75">{item.a}</p>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="rounded-[22px] bg-card p-[18px] flex flex-col items-start gap-3.5 mt-1">
        <p className="font-serif text-[23px] leading-[1.15] text-foreground">Still stuck?</p>
        <button onClick={onSupport} className={INK_BUTTON}>Contact support</button>
      </div>
    </Screen>
  );
}

// ─── Contact support ───────────────────────────────────────────────────────

const TOPICS = ["Something's broken", "A question", "An idea", "My account"];

export function SupportScreen({ onBack, onDone, backLabel }: { onBack: () => void; onDone: () => void; backLabel?: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const send = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/support", {
      name: user?.name || "Spliiit user",
      email: user?.email || "",
      subject: topic,
      message: message.trim(),
    }),
    onSuccess: () => { setSent(true); setMessage(""); },
    onError: (err) => toast({ title: "Couldn't send", description: errorText(err), variant: "destructive" }),
  });

  const submit = () => {
    if (!message.trim()) { setError("Write a message first."); messageRef.current?.focus(); return; }
    send.mutate();
  };

  if (sent) {
    return (
      <div className="flex-1 flex flex-col justify-center items-start px-5 pb-20" data-testid="screen-support-sent">
        <h3 className="font-serif text-[36px] leading-none text-foreground mb-3">Message sent</h3>
        <p className="text-sm leading-relaxed text-muted-foreground mb-6">We'll reply to {user?.email}.</p>
        <button onClick={onDone} className={INK_BUTTON} data-testid="support-done">Back to menu</button>
      </div>
    );
  }

  return (
    <Screen onBack={onBack} backLabel={backLabel} title="Contact support" intro={<>We'll reply to <span className="text-foreground break-all">{user?.email}</span>.</>} testId="screen-support">
      <Label>What's it about?</Label>
      <div className="flex flex-wrap gap-2 px-0.5 mb-5" role="group" aria-label="Topic">
        {TOPICS.map((t) => (
          <button
            key={t}
            aria-pressed={topic === t}
            onClick={() => setTopic(t)}
            className={`rounded-full px-3.5 py-2 text-sm ${topic === t ? "bg-foreground text-background" : "bg-card text-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <Label htmlFor="support-message">Message</Label>
      <div className="rounded-[22px] bg-card p-3 mb-2">
        <textarea
          id="support-message"
          ref={messageRef}
          value={message}
          onChange={(e) => { setMessage(e.target.value); setError(""); }}
          placeholder="Tell us what happened, or what you'd like to see"
          maxLength={2000}
          rows={7}
          className={`${FIELD} resize-none leading-snug`}
          data-testid="support-message"
        />
        <p className="text-[11px] text-muted-foreground text-right mt-1.5 mr-1">{message.length}/2000</p>
      </div>
      {error && <p className="text-[13px] text-destructive px-2 mb-2">{error}</p>}
      <button onClick={submit} disabled={send.isPending} className={`${INK_BUTTON} w-full mt-2`} data-testid="support-submit">
        {send.isPending ? "Sending…" : "Send message"}
      </button>
    </Screen>
  );
}

// ─── Invite a friend ───────────────────────────────────────────────────────

export function InviteScreen({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const url = user?.referralCode ? `https://spliiit.ca?ref=${user.referralCode}` : "https://spliiit.ca";
  const text = "Hey! I use Spliiit to split expenses with friends and groups. Join me:";
  return (
    <Screen onBack={onBack} title="Invite a friend" intro="Share Spliiit so you can split expenses together." testId="screen-invite">
      <ShareChannels url={url} text={text} emailSubject="Join me on Spliiit" variant="paper" />
      <Label>Your message</Label>
      <div className="rounded-[22px] bg-card px-[18px] py-4 text-sm leading-relaxed text-foreground">
        {text} <span className="text-accent-foreground break-all">{url.replace(/^https?:\/\//, "")}</span>
      </div>
    </Screen>
  );
}

// ─── Delete account ────────────────────────────────────────────────────────

export function DeleteAccountScreen({ onBack, onConfirm, deleting }: { onBack: () => void; onConfirm: () => void; deleting: boolean }) {
  const [step, setStep] = useState<1 | 2>(1);
  return (
    <div className="flex-1 flex flex-col px-4 pt-3 pb-6 overflow-y-auto" data-testid="screen-delete">
      <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground self-start px-1 py-2.5 mb-1">← Account</button>
      {step === 1 ? (
        <>
          <h3 className="font-serif text-[36px] leading-none text-foreground px-1 mb-2">Delete your account?</h3>
          <p className="text-sm leading-relaxed text-muted-foreground px-1 mb-5">This removes your profile and everything attached to it:</p>
          <div className="rounded-[22px] bg-card px-4 py-2">
            {["Expenses", "Groups", "Friends", "History"].map((x) => <p key={x} className="text-[15px] text-foreground py-2.5">{x}</p>)}
          </div>
          <div className="mt-auto pt-8 flex flex-col items-center gap-1.5">
            <button onClick={onBack} className={`${INK_BUTTON} w-full`} data-testid="delete-cancel-1">Keep my account</button>
            <button onClick={() => setStep(2)} className="text-sm text-destructive px-4 py-3" data-testid="delete-confirm-1">Delete account</button>
          </div>
        </>
      ) : (
        <>
          <h3 className="font-serif text-[36px] leading-none text-foreground px-1 mb-2">This can't be undone</h3>
          <p className="text-sm leading-relaxed text-muted-foreground px-1">Your expenses, groups, friends and history will be deleted for good. There's no way to get them back.</p>
          <div className="mt-auto pt-8 flex flex-col items-center gap-1.5">
            <button
              onClick={onConfirm}
              disabled={deleting}
              className="w-full rounded-full bg-destructive text-destructive-foreground text-sm font-medium px-5 py-3 disabled:opacity-60"
              data-testid="delete-confirm-2"
            >
              {deleting ? "Deleting…" : "Delete forever"}
            </button>
            <button onClick={onBack} className="text-sm text-muted-foreground px-4 py-3" data-testid="delete-cancel-2">Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
