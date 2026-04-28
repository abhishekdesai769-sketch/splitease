import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Headphones, Send, Loader2, CheckCircle2, UserPlus, Copy, Check, MessageCircle, Mail, Trash2, AlertTriangle, Upload, HelpCircle, ChevronDown, Bell, Crown, Lock, Monitor, Moon, Settings, Sun, Star } from "lucide-react";
import { getStorePlatform, getStoreLink } from "@/lib/reviewPrompt";
import { useTheme, type ThemePref } from "@/lib/theme";
import { CURRENCIES } from "@/components/CurrencySelector";
import { useLocation } from "wouter";
import { UpgradePromptSheet } from "@/components/UpgradePromptSheet";

// ─── Email preview generator ─────────────────────────────────────────────────
// Mirrors the exact wording in server/email.ts sendAutoReminderEmail()
// Uses "Jamie" as placeholder debtor name so the owner sees a realistic preview.

type ReminderTone = "friendly" | "funny" | "firm" | "passive-aggressive" | "awkward";

function getEmailPreview(tone: ReminderTone, ownerName: string): { subject: string; body: string } {
  const debtor = "Jamie";
  const amt = "$42.00";

  const subjects: Record<ReminderTone, string> = {
    friendly:             `👋 Friendly nudge from Spliiit — you owe ${ownerName} money`,
    funny:                `Fun fact: you owe ${ownerName} ${amt} 😄`,
    firm:                 `Payment reminder: you have an outstanding balance with ${ownerName}`,
    "passive-aggressive": `No worries at all! Just a tiny lil reminder 🙂`,
    awkward:              `We really didn't want to send this, but... 😬`,
  };

  const bodies: Record<ReminderTone, string> = {
    friendly:
      `Hey ${debtor}! 👋\n\nSpliiit here — just a quick, friendly nudge that you have an outstanding balance of ${amt} with ${ownerName} on the app.\n\nNo stress at all, but whenever you get a chance to settle up it would mean a lot! Tap the button below to sort it out in seconds.\n\n— Spliiit`,
    funny:
      `Hi ${debtor} 😄\n\nFun fact: you owe ${ownerName} ${amt}. Less fun fact: it's been sitting there for a while. Even less fun fact: Spliiit just sent you this email about it.\n\nGood news though — settling up takes about 10 seconds flat. Then we can all move on with our lives. Deal?\n\n— Spliiit (comedy writer by night, balance tracker by day)`,
    firm:
      `Hi ${debtor},\n\nThis is an automated reminder from Spliiit that you have an outstanding balance of ${amt} owed to ${ownerName}.\n\nPlease settle this at your earliest convenience using the button below.\n\nThank you,\nSpliiit`,
    "passive-aggressive":
      `Hi ${debtor},\n\nNo worries at all! Totally fine! Just wanted to pop in and gently, warmly, completely-non-aggressively mention that you still owe ${ownerName} ${amt}. No rush whatsoever. We're sure you've just been super busy. Completely understandable. 😊\n\nThe "Settle Up" button is right there whenever you're ready. Take your time. We'll wait.\n\n— Spliiit 🙂`,
    awkward:
      `Hey ${debtor}... we genuinely debated whether to send this. Like, a lot.\n\nBut here's the thing — you still owe ${ownerName} ${amt} and it's gotten to the point where NOT saying something is somehow weirder than saying something. So. We said something.\n\nPlease click the button. For everyone's sake.\n\n— Spliiit (this was hard for us too) 🙈`,
  };

  return { subject: subjects[tone], body: bodies[tone] };
}

export function SupportDrawer({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "support" | "invite" | "delete" | "sent" | "faq" | "reminders" | "preferences">("menu");
  const { themePref, setThemePref } = useTheme();
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  // Support form state
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [upgradeSheetOpen, setUpgradeSheetOpen] = useState(false);
  const qc = useQueryClient();

  // Auto-reminder settings (loaded when drawer opens)
  const { data: reminderSettings } = useQuery({
    queryKey: ["/api/reminder-settings"],
    enabled: open && !!user?.isPremium,
  });
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [reminderDays, setReminderDays] = useState(7);
  const [reminderTone, setReminderTone] = useState<ReminderTone>("friendly");

  // Sync local state when server data arrives
  useEffect(() => {
    const rs = reminderSettings as any;
    if (!rs) return;
    setReminderEnabled(rs.reminderEnabled ?? false);
    setReminderDays(rs.reminderDays ?? 7);
    setReminderTone(rs.reminderTone ?? "friendly");
  }, [reminderSettings]);

  const saveReminderMutation = useMutation({
    mutationFn: async (data: { reminderEnabled: boolean; reminderDays: number; reminderTone: string }) => {
      const res = await apiRequest("PATCH", "/api/reminder-settings", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/reminder-settings"] });
      toast({ title: "Reminder settings saved ✓" });
    },
    onError: () => toast({ title: "Error", description: "Could not save settings", variant: "destructive" }),
  });

  const APP_URL = "https://spliiit.klarityit.ca";
  const inviteText = `Hey! I use Spliiit to split expenses with friends and groups. Check it out: ${APP_URL}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(APP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const el = document.createElement("textarea");
      el.value = APP_URL;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const resetForm = () => {
    setSubject("");
    setMessage("");
    setName(user?.name || "");
    setEmail(user?.email || "");
    setView("menu");
    setDeleteStep(0);
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      await apiRequest("DELETE", "/api/user/delete-account");
      setOpen(false);
      logout();
    } catch (err: any) {
      const msg = err.message || "Failed to delete account.";
      let parsed = msg;
      try { parsed = JSON.parse(msg.split(": ").slice(1).join(": ")).error || msg; } catch {}
      toast({ title: "Error", description: parsed, variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      // Reset on close after a short delay so closing animation is smooth
      setTimeout(resetForm, 300);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !subject.trim() || !message.trim()) return;
    setSending(true);
    try {
      await apiRequest("POST", "/api/support", {
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
      });
      setView("sent");
    } catch (err: any) {
      const msg = err.message || "Failed to send. Try again.";
      let parsed = msg;
      try { parsed = JSON.parse(msg.split(": ").slice(1).join(": ")).error || msg; } catch {}
      toast({ title: "Error", description: parsed, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        {children}
      </SheetTrigger>
      <SheetContent side="left" className="w-[320px] sm:w-[360px] flex flex-col p-0">
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-2.5">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-label="Spliiit logo">
              <rect width="32" height="32" rx="8" fill="hsl(172 63% 45%)" fillOpacity="0.15" />
              <path d="M9 11h14M9 16h14M9 21h14" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
              <path d="M16 8v16" stroke="hsl(172 63% 45%)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <SheetTitle className="text-base font-semibold tracking-tight">
              Spl<span className="text-primary">iii</span>t
            </SheetTitle>
          </div>
        </SheetHeader>

        {/* ===== MENU VIEW ===== */}
        {view === "menu" && (
          <div className="flex-1 flex flex-col px-5">
            {/* User info */}
            {user && (
              <div className="mb-5 p-3 rounded-lg bg-muted/40 border border-border">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
            )}

            {/* Contact Support */}
            <button
              onClick={() => setView("support")}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/50 transition-colors text-left group"
              data-testid="menu-contact-support"
            >
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Headphones className="w-4.5 h-4.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">Contact Support</p>
                <p className="text-xs text-muted-foreground">Report issues or ask questions</p>
              </div>
            </button>

            {/* Invite a Friend */}
            <button
              onClick={() => setView("invite")}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/50 transition-colors text-left group"
              data-testid="menu-invite-friend"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                <UserPlus className="w-4.5 h-4.5 text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-medium">Invite a Friend</p>
                <p className="text-xs text-muted-foreground">Share Spliiit with your friends</p>
              </div>
            </button>

            {/* Leave a Review */}
            <button
              onClick={() => window.open(getStoreLink(getStorePlatform()), "_blank", "noopener,noreferrer")}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/50 transition-colors text-left group"
              data-testid="menu-leave-review"
            >
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <Star className="w-4.5 h-4.5 text-amber-500 fill-amber-500" />
              </div>
              <div>
                <p className="text-sm font-medium">Leave a Review ⭐</p>
                <p className="text-xs text-muted-foreground">Takes 30 seconds · means the world to us</p>
              </div>
            </button>

            {/* Import from Splitwise */}
            <button
              onClick={() => { setOpen(false); setLocation("/import"); }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/50 transition-colors text-left group"
              data-testid="menu-import-splitwise"
            >
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Upload className="w-4.5 h-4.5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm font-medium">Import from Splitwise</p>
                <p className="text-xs text-muted-foreground">Import expenses from a CSV file</p>
              </div>
            </button>

            {/* Auto Reminders */}
            <button
              onClick={() => setView("reminders")}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/50 transition-colors text-left group"
              data-testid="menu-auto-reminders"
            >
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <Bell className="w-4.5 h-4.5 text-amber-500" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium">Auto Reminders</p>
                  {!user?.isPremium && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                      <Crown className="w-2.5 h-2.5" /> Premium
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Auto-email people who owe you</p>
              </div>
            </button>

            {/* Preferences */}
            <button
              onClick={() => setView("preferences")}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/50 transition-colors text-left group"
              data-testid="menu-preferences"
            >
              <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                <Settings className="w-4.5 h-4.5 text-indigo-500" />
              </div>
              <div>
                <p className="text-sm font-medium">Preferences</p>
                <p className="text-xs text-muted-foreground">Currency & appearance</p>
              </div>
            </button>

            {/* FAQs */}
            <button
              onClick={() => setView("faq")}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted/50 transition-colors text-left group"
              data-testid="menu-faq"
            >
              <div className="w-9 h-9 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0">
                <HelpCircle className="w-4.5 h-4.5 text-violet-500" />
              </div>
              <div>
                <p className="text-sm font-medium">FAQs</p>
                <p className="text-xs text-muted-foreground">How to use Spliiit</p>
              </div>
            </button>

            {/* Upgrade to Premium — only shown to non-premium users, softly */}
            {!user?.isPremium && (
              <button
                onClick={() => { setOpen(false); setLocation("/upgrade"); }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-amber-500/5 transition-colors text-left group"
                data-testid="menu-upgrade"
              >
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <Crown className="w-4.5 h-4.5 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-amber-500">Upgrade to Premium</p>
                  <p className="text-xs text-muted-foreground">Unlock all features</p>
                </div>
              </button>
            )}

            {/* Delete Account */}
            <button
              onClick={() => { setDeleteStep(1); setView("delete"); }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-red-500/10 transition-colors text-left group"
              data-testid="menu-delete-account"
            >
              <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-4.5 h-4.5 text-red-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-red-500">Delete Account</p>
                <p className="text-xs text-muted-foreground">Permanently remove your account</p>
              </div>
            </button>

            {/* Spacer */}
            <div className="flex-1" />
          </div>
        )}

        {/* ===== SUPPORT FORM VIEW ===== */}
        {view === "support" && (
          <div className="flex-1 flex flex-col px-5">
            <button
              onClick={() => setView("menu")}
              className="text-xs text-muted-foreground hover:text-foreground mb-3 self-start"
            >
              ← Back
            </button>

            <h3 className="text-sm font-semibold mb-4">Contact Support</h3>

            <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="support-name" className="text-xs">Name</Label>
                <Input
                  id="support-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                  data-testid="support-name"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="support-email" className="text-xs">Email</Label>
                <Input
                  id="support-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  data-testid="support-email"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="support-subject" className="text-xs">Subject</Label>
                <Input
                  id="support-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What do you need help with?"
                  required
                  data-testid="support-subject"
                />
              </div>

              <div className="space-y-1.5 flex-1">
                <Label htmlFor="support-message" className="text-xs">Message</Label>
                <Textarea
                  id="support-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Describe your issue or question..."
                  required
                  maxLength={2000}
                  className="min-h-[120px] resize-none"
                  data-testid="support-message"
                />
                <p className="text-[11px] text-muted-foreground text-right">{message.length}/2000</p>
              </div>

              <Button
                type="submit"
                className="w-full mb-5"
                disabled={sending || !name.trim() || !email.trim() || !subject.trim() || !message.trim()}
                data-testid="support-submit"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-1.5" />
                    Send Message
                  </>
                )}
              </Button>
            </form>
          </div>
        )}

        {/* ===== INVITE VIEW ===== */}
        {view === "invite" && (
          <div className="flex-1 flex flex-col px-5">
            <button
              onClick={() => setView("menu")}
              className="text-xs text-muted-foreground hover:text-foreground mb-3 self-start"
            >
              ← Back
            </button>

            <h3 className="text-sm font-semibold mb-2">Invite a Friend</h3>
            <p className="text-xs text-muted-foreground mb-5">
              Share Spliiit with friends so you can split expenses together.
            </p>

            {/* Copy Link */}
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-3 px-3 py-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left mb-3"
              data-testid="invite-copy-link"
            >
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
              </div>
              <div>
                <p className="text-sm font-medium">{copied ? "Link Copied" : "Copy Link"}</p>
                <p className="text-xs text-muted-foreground truncate max-w-[200px]">{APP_URL}</p>
              </div>
            </button>

            {/* WhatsApp */}
            <a
              href={`https://wa.me/?text=${encodeURIComponent(inviteText)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-3 py-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left mb-3"
              data-testid="invite-whatsapp"
            >
              <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-4 h-4 text-green-500" />
              </div>
              <div>
                <p className="text-sm font-medium">WhatsApp</p>
                <p className="text-xs text-muted-foreground">Send via WhatsApp</p>
              </div>
            </a>

            {/* SMS / Text */}
            <a
              href={`sms:?body=${encodeURIComponent(inviteText)}`}
              className="flex items-center gap-3 px-3 py-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left mb-3"
              data-testid="invite-sms"
            >
              <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Send className="w-4 h-4 text-blue-500" />
              </div>
              <div>
                <p className="text-sm font-medium">Text Message</p>
                <p className="text-xs text-muted-foreground">Send via SMS</p>
              </div>
            </a>

            {/* Email */}
            <a
              href={`mailto:?subject=${encodeURIComponent("Join me on Spliiit")}&body=${encodeURIComponent(inviteText)}`}
              className="flex items-center gap-3 px-3 py-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left mb-3"
              data-testid="invite-email"
            >
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <Mail className="w-4 h-4 text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-medium">Email</p>
                <p className="text-xs text-muted-foreground">Send via email</p>
              </div>
            </a>
          </div>
        )}

        {/* ===== DELETE ACCOUNT VIEW ===== */}
        {view === "delete" && (
          <div className="flex-1 flex flex-col px-5">
            <button
              onClick={() => { setDeleteStep(0); setView("menu"); }}
              className="text-xs text-muted-foreground hover:text-foreground mb-3 self-start"
            >
              ← Back
            </button>

            <h3 className="text-sm font-semibold text-red-500 mb-4">Delete Account</h3>

            {deleteStep === 1 && (
              <div className="rounded-lg border-2 border-red-500/30 bg-red-500/5 p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                    <Trash2 className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-red-500">Do you really want to delete your account?</p>
                    <p className="text-xs text-muted-foreground mt-0.5">This will remove your profile and all associated data.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setDeleteStep(0); setView("menu"); }}
                    data-testid="delete-cancel-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => setDeleteStep(2)}
                    data-testid="delete-confirm-1"
                  >
                    Yes, Delete
                  </Button>
                </div>
              </div>
            )}

            {deleteStep === 2 && (
              <div className="rounded-lg border-2 border-red-500/50 bg-red-500/10 p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-red-500">This cannot be undone</p>
                    <p className="text-xs text-muted-foreground mt-0.5">You will lose ALL data attached to your account — expenses, groups, friends, and history. This action is permanent.</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => { setDeleteStep(0); setView("menu"); }}
                    data-testid="delete-cancel-2"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={handleDeleteAccount}
                    disabled={isDeleting}
                    data-testid="delete-confirm-2"
                  >
                    {isDeleting ? (
                      <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Deleting...</>
                    ) : (
                      "Delete Anyway"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== AUTO REMINDERS VIEW ===== */}
        {view === "reminders" && (() => {
          const preview = getEmailPreview(reminderTone, user?.name || "You");
          const isPremium = !!user?.isPremium;
          return (
            <div className="flex-1 flex flex-col px-5 overflow-y-auto pb-6">
              <button
                onClick={() => setView("menu")}
                className="text-xs text-muted-foreground hover:text-foreground mb-3 self-start flex-shrink-0"
              >
                ← Back
              </button>

              <h3 className="text-sm font-semibold mb-1 flex-shrink-0">Auto Reminders</h3>
              <p className="text-xs text-muted-foreground mb-4 flex-shrink-0 leading-relaxed">
                Spliiit automatically emails people who owe you — from Spliiit's account, not yours.
              </p>

              {/* Non-premium banner */}
              {!isPremium && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 mb-4 flex items-start gap-2 flex-shrink-0">
                  <Crown className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-amber-500 mb-0.5">Premium feature</p>
                    <p className="text-xs text-muted-foreground mb-1">Upgrade to turn on auto reminders. Preview the emails below for free.</p>
                    <button onClick={() => setUpgradeSheetOpen(true)} className="text-xs text-amber-500 font-semibold">
                      Get Premium →
                    </button>
                  </div>
                </div>
              )}

              {/* Enable toggle */}
              <div className={`flex items-center justify-between px-3 py-3 rounded-lg border border-border mb-4 ${!isPremium ? "opacity-60" : ""}`}>
                <div>
                  <p className="text-sm font-medium">Enable auto reminders</p>
                  <p className="text-xs text-muted-foreground">Spliiit emails debtors on your behalf</p>
                </div>
                {isPremium ? (
                  <Switch checked={reminderEnabled} onCheckedChange={setReminderEnabled} />
                ) : (
                  <button
                    onClick={() => setUpgradeSheetOpen(true)}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full"
                  >
                    <Crown className="w-3 h-3" /> Premium
                  </button>
                )}
              </div>

              {/* Time frame */}
              <div className={`mb-4 ${!isPremium ? "opacity-60" : ""}`}>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Send reminder after</p>
                <div className="grid grid-cols-3 gap-2">
                  {[7, 14, 30].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setReminderDays(d)}
                      className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                        reminderDays === d
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {d} days
                    </button>
                  ))}
                </div>
              </div>

              {/* Tone dropdown */}
              <div className="mb-3">
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Tone</p>
                <Select
                  value={reminderTone}
                  onValueChange={(v) => setReminderTone(v as ReminderTone)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">😊 Friendly — Warm &amp; casual</SelectItem>
                    <SelectItem value="funny">😂 Funny — Light humour</SelectItem>
                    <SelectItem value="firm">💼 Firm — Professional</SelectItem>
                    <SelectItem value="passive-aggressive">😏 Passive-Aggressive — Polite but pointed</SelectItem>
                    <SelectItem value="awkward">😬 Awkward — Cringe energy</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Email preview */}
              <div className="mb-4">
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                  Email preview <span className="normal-case font-normal">(placeholder: Jamie owes you $42.00)</span>
                </p>
                <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
                  {/* Subject row */}
                  <div className="px-3 py-2.5 border-b border-border bg-muted/40">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Subject</p>
                    <p className="text-xs font-semibold text-foreground leading-snug">{preview.subject}</p>
                  </div>
                  {/* Body */}
                  <div className="px-3 py-3">
                    <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{preview.body}</p>
                  </div>
                  {/* Footer hint */}
                  <div className="px-3 py-2.5 border-t border-border bg-muted/30">
                    <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                      + A "Why did you receive this?" section is automatically added beneath — it explains Spliiit sent this, not you personally, and links them to Premium.
                    </p>
                  </div>
                </div>
              </div>

              {/* Save */}
              <Button
                className="w-full"
                size="lg"
                onClick={() => isPremium && saveReminderMutation.mutate({ reminderEnabled, reminderDays, reminderTone })}
                disabled={!isPremium || saveReminderMutation.isPending}
              >
                {saveReminderMutation.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                  : "Save Settings"
                }
              </Button>
              {!isPremium && (
                <p className="text-xs text-center text-muted-foreground mt-2">
                  <button onClick={() => setUpgradeSheetOpen(true)} className="text-amber-500 font-semibold">Get Premium</button> to save &amp; activate
                </p>
              )}
            </div>
          );
        })()}

        {/* ===== FAQ VIEW ===== */}
        {view === "faq" && (() => {
          const faqs = [
            {
              q: "How do I add an expense with a friend?",
              a: "Go to the Friends tab, tap a friend's name to open their detail page, then tap the '+ Expense' button in the top right. Enter the description, amount, who paid, and how to split it.",
            },
            {
              q: "How do I add an expense in a group?",
              a: "Open the group from the Groups tab, then tap '+ Add Expense'. Fill in the description, amount, who paid, and choose how to split (equally, by percentage, or custom amounts).",
            },
            {
              q: "What's the difference between Groups and Friends?",
              a: "Groups are for shared expenses among 3+ people (e.g. roommates, trips). Friends are for one-on-one expenses directly between you and another person. Both track who owes whom.",
            },
            {
              q: "How do I settle up with someone?",
              a: "On a friend's detail page or a group page, tap the 'Settle Up' button when you have an outstanding balance. This records a payment and resets the balance to zero.",
            },
            {
              q: "How do I import expenses from Splitwise?",
              a: "In Splitwise, export a group as a CSV file. In Spliiit, tap 'Import from Splitwise' in this menu, then follow the steps to upload the CSV, match names to your contacts, and import.",
            },
            {
              q: "Can I import expenses for a friend (not a group)?",
              a: "Yes! Open the friend's detail page, tap the three-dot menu (⋮) next to the friend's name, then tap 'Import from another app'. Upload your Splitwise CSV and select which column is you.",
            },
            {
              q: "How do I export my expenses?",
              a: "On a friend's detail page or group page, tap 'Export expenses'. A CSV summary will be sent to your email address.",
            },
            {
              q: "What is a 'ghost member'?",
              a: "A ghost member is a placeholder for someone you split with who hasn't joined Spliiit yet. Their expenses are tracked, and they receive an email invite to claim their account.",
            },
            {
              q: "How do I invite someone to join?",
              a: "Tap 'Invite a Friend' in this menu and share the link via WhatsApp, SMS, or email. You can also add them to a group — they'll automatically receive an invite when you include their email.",
            },
            {
              q: "Are receipt photos stored in the app?",
              a: "No — receipt photos are never stored in Spliiit. When you attach a photo to an expense, it is sent directly to everyone included in that split via email. Nothing is saved inside the app.",
            },
            {
              q: "How many transactions and receipt photos can I add per day?",
              a: "You can add unlimited transactions and attach unlimited receipt photos every day. This is a core feature of Spliiit and will always be completely free.",
            },
            {
              q: "How do I delete an expense?",
              a: "Open the expense in a group or friend detail page, then tap the trash icon next to it. You can only delete expenses you added (unless you're an admin).",
            },
            {
              q: "How do I change the app theme (dark/light mode)?",
              a: "Tap the logo in the top left to open the menu, then tap Preferences. You can choose Light, Dark, or System (which follows your device's setting). You can also tap the sun/moon icon in the top right to quickly toggle between light and dark.",
            },
            {
              q: "How do I delete my account?",
              a: "Tap 'Delete Account' at the bottom of this menu. You'll be asked to confirm twice. This permanently removes all your data including expenses, groups, and friends — it cannot be undone.",
            },
          ];
          return (
            <div className="flex-1 flex flex-col px-5 overflow-y-auto">
              <button
                onClick={() => { setView("menu"); setFaqOpen(null); }}
                className="text-xs text-muted-foreground hover:text-foreground mb-3 self-start flex-shrink-0"
              >
                ← Back
              </button>
              <h3 className="text-sm font-semibold mb-1 flex-shrink-0">Frequently Asked Questions</h3>
              <p className="text-xs text-muted-foreground mb-4 flex-shrink-0">Tap a question to expand the answer.</p>
              <div className="space-y-2 pb-5">
                {faqs.map((faq, i) => (
                  <div key={i} className="rounded-lg border border-border overflow-hidden">
                    <button
                      className="w-full text-left px-3 py-3 flex items-center justify-between gap-2 hover:bg-muted/40 transition-colors"
                      onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                    >
                      <p className="text-sm font-medium leading-snug">{faq.q}</p>
                      <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200 ${faqOpen === i ? "rotate-180" : ""}`} />
                    </button>
                    {faqOpen === i && (
                      <div className="px-3 pb-3 border-t border-border">
                        <p className="text-xs text-muted-foreground leading-relaxed pt-2">{faq.a}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ===== PREFERENCES VIEW ===== */}
        {view === "preferences" && (() => {
          const currencyInfo = CURRENCIES.find((c) => c.code === user?.defaultCurrency);
          const themeOptions: { pref: ThemePref; icon: React.ReactNode; label: string }[] = [
            { pref: "light",  icon: <Sun className="w-4 h-4" />,     label: "Light"  },
            { pref: "dark",   icon: <Moon className="w-4 h-4" />,    label: "Dark"   },
            { pref: "system", icon: <Monitor className="w-4 h-4" />, label: "System" },
          ];
          return (
            <div className="flex-1 flex flex-col px-5 overflow-y-auto pb-6">
              <button
                onClick={() => setView("menu")}
                className="text-xs text-muted-foreground hover:text-foreground mb-3 self-start flex-shrink-0"
              >
                ← Back
              </button>

              <h3 className="text-sm font-semibold mb-1 flex-shrink-0">Preferences</h3>
              <p className="text-xs text-muted-foreground mb-5 flex-shrink-0">
                Manage your currency and appearance settings.
              </p>

              {/* Currency (locked) */}
              <div className="mb-5">
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Default Currency</p>
                <div className="px-3 py-3 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-foreground">
                      {currencyInfo ? `${currencyInfo.name} (${currencyInfo.code})` : user?.defaultCurrency ?? "Not set"}
                    </p>
                    <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">Set at account setup · cannot be changed</p>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                  Need to change it?{" "}
                  <button onClick={() => setView("support")} className="text-primary underline">Contact support</button>.
                </p>
              </div>

              {/* Theme */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Appearance</p>
                <div className="grid grid-cols-3 gap-2">
                  {themeOptions.map(({ pref, icon, label }) => (
                    <button
                      key={pref}
                      type="button"
                      onClick={() => setThemePref(pref)}
                      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all ${
                        themePref === pref
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted/50"
                      }`}
                    >
                      {icon}
                      <span className="text-xs font-semibold">{label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  System follows your device's dark/light setting automatically.
                </p>
              </div>
            </div>
          );
        })()}

        {/* ===== SENT CONFIRMATION VIEW ===== */}
        {view === "sent" && (
          <div className="flex-1 flex flex-col items-center justify-center px-5 text-center">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-7 h-7 text-primary" />
            </div>
            <h3 className="text-base font-semibold mb-1">Message Sent</h3>
            <p className="text-sm text-muted-foreground mb-6">
              We'll get back to you at <span className="font-medium text-foreground">{email}</span> as soon as possible.
            </p>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              data-testid="support-done"
            >
              Done
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>

    {/* Inline upgrade sheet for non-premium users clicking Auto Reminders */}
    <UpgradePromptSheet open={upgradeSheetOpen} onClose={() => setUpgradeSheetOpen(false)} />
  </>
  );
}
