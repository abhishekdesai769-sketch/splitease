import { useEffect, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bell, ChevronRight, Clock, Download, HelpCircle, Lock, MessageCircle, Wallet } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { isIosNative } from "@/lib/iap";
import { CURRENCIES } from "@/components/CurrencySelector";

// The menu drawer's home screen and the Account screen behind the name row.
// Design language (see the Spliiit prototype): paper groups floating on the
// drawer's beige, Instrument Serif for names and headlines, plain stroke
// icons, no hairlines, terracotta only on the invite button.

const PRIVACY_URL = "https://spliiit.ca/privacy";
const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
// "You" is always ink — same as the quick-add cards (dashboard passes #292624
// for the signed-in user). Stored avatar colours on older accounts can be loud.
const SELF_COLOR = "#292624";

function errorText(err: Error): string {
  try { return JSON.parse(err.message.split(": ").slice(1).join(": ")).error || err.message; } catch { return err.message; }
}

function Initial({ name, color, size }: { name: string; color: string; size: number }) {
  return (
    <span
      className="rounded-full flex items-center justify-center text-white font-serif shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.54), backgroundColor: color || "#292624" }}
      aria-hidden="true"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground px-3.5 pb-2">{children}</p>;
}

function Row({ icon, title, sub, onClick, testId }: { icon: ReactNode; title: string; sub?: string; onClick: () => void; testId: string }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3.5 py-3 min-h-[48px] rounded-[18px] text-left active:bg-foreground/[0.04] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={testId}
    >
      <span className="text-foreground/55 shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] text-foreground">{title}</span>
        {sub && <span className="block text-xs text-muted-foreground leading-snug mt-0.5">{sub}</span>}
      </span>
      <ChevronRight className="w-4 h-4 text-foreground/30 shrink-0" />
    </button>
  );
}

export function DrawerHome({
  onAccount, onPayment, onReminders, onNotifications, onImport, onFaq, onSupport, onInvite,
}: {
  onAccount: () => void; onPayment: () => void; onReminders: () => void; onNotifications: () => void;
  onImport: () => void; onFaq: () => void; onSupport: () => void; onInvite: () => void;
}) {
  const { user, logout } = useAuth();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isIosNative) return;
    import("@capacitor/app").then(({ App }) => App.getInfo()).then((info) => setVersion(info.version)).catch(() => {});
  }, []);

  if (!user) return null;
  const icon = "w-5 h-5";

  return (
    <div className="flex-1 flex flex-col px-4 pt-4 pb-4 overflow-y-auto" data-testid="drawer-home">
      {/* my-auto centres the menu in the space above the footer; when the
          screen is too short it collapses to 0 so nothing gets clipped. */}
      <div className="my-auto flex flex-col pb-4">
      <button
        onClick={onAccount}
        className="flex items-center gap-3 px-1.5 pb-5 min-h-[48px] text-left rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="menu-account"
      >
        <Initial name={user.name} color={SELF_COLOR} size={48} />
        <span className="flex-1 min-w-0">
          <span className="block font-serif text-[26px] leading-[1.1] text-foreground truncate">{user.name}</span>
          <span className="block text-[13px] text-muted-foreground">View account</span>
        </span>
        <ChevronRight className="w-[18px] h-[18px] text-foreground/30 shrink-0" />
      </button>

      <GroupLabel>You</GroupLabel>
      <div className="rounded-[22px] bg-card p-1 mb-4">
        <Row icon={<Wallet className={icon} />} title="How I get paid" sub="Friends see this when they settle up" onClick={onPayment} testId="menu-payment" />
        <Row icon={<Clock className={icon} />} title="Auto reminders" sub="Email people who owe you" onClick={onReminders} testId="menu-auto-reminders" />
        <Row icon={<Bell className={icon} />} title="Notifications" onClick={onNotifications} testId="menu-notifications" />
      </div>

      <GroupLabel>Spliiit</GroupLabel>
      <div className="rounded-[22px] bg-card p-1 mb-4">
        <Row icon={<Download className={icon} />} title="Import from Splitwise" onClick={onImport} testId="menu-import-splitwise" />
        <Row icon={<HelpCircle className={icon} />} title="FAQs" onClick={onFaq} testId="menu-faq" />
        <Row icon={<MessageCircle className={icon} />} title="Contact support" onClick={onSupport} testId="menu-contact-support" />
      </div>

      <div className="rounded-[22px] bg-card p-[18px] flex flex-col items-start gap-3.5">
        <p className="font-serif text-[23px] leading-[1.15] text-foreground">Know someone who always fronts the bill?</p>
        <button
          onClick={onInvite}
          className="rounded-full bg-[hsl(18_38%_44%)] text-card text-sm font-medium px-5 py-3"
          data-testid="menu-invite-friend"
        >
          Invite a friend
        </button>
      </div>
      </div>

      <div className="flex items-center justify-between px-2 text-[13px] text-muted-foreground">
        <button onClick={() => logout()} className="py-3 px-1.5" data-testid="menu-sign-out">Sign out</button>
        <span className="flex items-center gap-3">
          <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="py-3">Privacy</a>
          <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="py-3">Terms</a>
          {version && <span>v{version}</span>}
        </span>
      </div>
    </div>
  );
}

export function AccountView({ onBack, onDelete }: { onBack: () => void; onDelete: () => void }) {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState(user?.name ?? "");
  const [nameError, setNameError] = useState("");

  const saveName = useMutation({
    mutationFn: async (name: string) => (await apiRequest("PATCH", "/api/user/name", { name })).json(),
    onSuccess: async () => {
      await refreshUser();
      setEditingName(false);
      toast({ title: "Name updated" });
    },
    onError: (err: Error) => setNameError(errorText(err)),
  });

  const exportAll = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/export/expenses", { scope: "all" })).json(),
    onSuccess: (data: any) => toast({ title: "Export sent", description: data?.message || "A spreadsheet of all your expenses is on its way to your email." }),
    onError: (err: Error) => toast({ title: "Couldn't export", description: errorText(err), variant: "destructive" }),
  });

  if (!user) return null;
  const currency = CURRENCIES.find((c) => c.code === user.defaultCurrency);

  const submitName = () => {
    const name = draft.trim();
    if (!name) { setNameError("Enter your name."); return; }
    if (name === user.name) { setEditingName(false); return; }
    saveName.mutate(name);
  };

  return (
    <div className="flex-1 flex flex-col px-4 pt-3 pb-5 overflow-y-auto" data-testid="drawer-account">
      <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground self-start px-1 py-2.5 mb-1">
        ← Menu
      </button>

      <div className="flex flex-col items-center gap-2.5 mt-1 mb-6">
        <Initial name={user.name} color={SELF_COLOR} size={84} />
        <p className="font-serif text-[32px] leading-[1.1] text-foreground text-center break-words max-w-full">{user.name}</p>
      </div>

      <div className="rounded-[22px] bg-card p-1 mb-4">
        {editingName ? (
          <form
            className="px-3.5 py-3"
            onSubmit={(e) => { e.preventDefault(); submitName(); }}
          >
            <label htmlFor="account-name" className="block text-xs text-muted-foreground mb-1.5">Name</label>
            <input
              id="account-name"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setNameError(""); }}
              maxLength={60}
              autoFocus
              autoComplete="name"
              className="w-full rounded-xl bg-background px-3 py-2.5 text-[15px] text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
            {nameError && <p className="text-[13px] text-destructive mt-1.5">{nameError}</p>}
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" onClick={() => { setEditingName(false); setDraft(user.name); setNameError(""); }} className="text-[13px] text-muted-foreground px-3 py-2">Cancel</button>
              <button type="submit" disabled={saveName.isPending} className="rounded-full bg-foreground text-background text-[13px] font-medium px-4 py-2">
                {saveName.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => { setDraft(user.name); setEditingName(true); }}
            className="w-full flex items-center gap-2.5 px-3.5 py-3 min-h-[48px] text-left rounded-[18px] active:bg-foreground/[0.04]"
            data-testid="account-edit-name"
          >
            <span className="flex-1 text-[15px] text-foreground">Name</span>
            <span className="text-sm text-muted-foreground truncate max-w-[55%]">{user.name}</span>
            <ChevronRight className="w-4 h-4 text-foreground/30 shrink-0" />
          </button>
        )}
        <div className="flex items-center gap-2.5 px-3.5 py-3 min-h-[48px]">
          <span className="flex-1 text-[15px] text-foreground">Email</span>
          <span className="text-sm text-muted-foreground truncate max-w-[62%]">{user.email}</span>
        </div>
        <div className="flex items-center gap-2.5 px-3.5 py-3 min-h-[48px]">
          <span className="flex-1">
            <span className="block text-[15px] text-foreground">Currency</span>
            <span className="block text-xs text-muted-foreground">Set at sign-up</span>
          </span>
          <span className="text-sm text-muted-foreground">{currency?.code ?? user.defaultCurrency ?? "Not set"}</span>
          <Lock className="w-3.5 h-3.5 text-foreground/30 shrink-0" aria-label="Can't be changed" />
        </div>
      </div>

      <div className="rounded-[22px] bg-card p-1">
        <button
          onClick={() => exportAll.mutate()}
          disabled={exportAll.isPending}
          className="w-full flex items-center gap-2.5 px-3.5 py-3 min-h-[48px] text-left rounded-[18px] active:bg-foreground/[0.04]"
          data-testid="account-export-all"
        >
          <span className="flex-1">
            <span className="block text-[15px] text-foreground">Export all my data</span>
            <span className="block text-xs text-muted-foreground">{exportAll.isPending ? "Sending…" : "Every group and friend, emailed as a spreadsheet"}</span>
          </span>
          <ChevronRight className="w-4 h-4 text-foreground/30 shrink-0" />
        </button>
      </div>

      <button
        onClick={onDelete}
        className="mt-auto pt-8 self-center text-sm text-destructive px-4 py-3"
        data-testid="menu-delete-account"
      >
        Delete account
      </button>
    </div>
  );
}
