import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Headphones, Send, Loader2, CheckCircle2, UserPlus, Copy, Check, MessageCircle, Mail, Trash2, AlertTriangle, Upload, HelpCircle, ChevronDown, Bell, Crown } from "lucide-react";
import { useLocation } from "wouter";
import { UpgradePromptSheet } from "@/components/UpgradePromptSheet";

export function SupportDrawer({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "support" | "invite" | "delete" | "sent" | "faq" | "reminders">("menu");
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
  const [reminderTone, setReminderTone] = useState<"friendly" | "firm" | "awkward">("friendly");

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
              onClick={() => user?.isPremium ? setView("reminders") : setUpgradeSheetOpen(true)}
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
        {view === "reminders" && (
          <div className="flex-1 flex flex-col px-5 overflow-y-auto">
            <button
              onClick={() => setView("menu")}
              className="text-xs text-muted-foreground hover:text-foreground mb-3 self-start flex-shrink-0"
            >
              ← Back
            </button>

            <h3 className="text-sm font-semibold mb-1 flex-shrink-0">Auto Reminders</h3>
            <p className="text-xs text-muted-foreground mb-5 flex-shrink-0 leading-relaxed">
              Spliiit will automatically email people who owe you — from Spliiit's account, not yours. No awkward texts needed.
            </p>

            {/* Enable toggle */}
            <div className="flex items-center justify-between px-3 py-3 rounded-lg border border-border mb-3">
              <div>
                <p className="text-sm font-medium">Enable auto reminders</p>
                <p className="text-xs text-muted-foreground">Spliiit emails debtors on your behalf</p>
              </div>
              <Switch
                checked={reminderEnabled}
                onCheckedChange={(v) => setReminderEnabled(v)}
              />
            </div>

            {/* Time frame */}
            <div className="mb-3">
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

            {/* Tone */}
            <div className="mb-5">
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Tone</p>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: "friendly", emoji: "😊", label: "Friendly" },
                  { id: "firm",     emoji: "💼", label: "Firm"     },
                  { id: "awkward",  emoji: "😬", label: "Awkward"  },
                ] as const).map(({ id, emoji, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setReminderTone(id)}
                    className={`py-2.5 rounded-lg border text-sm font-medium transition-colors flex flex-col items-center gap-0.5 ${
                      reminderTone === id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    <span className="text-base">{emoji}</span>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Info box */}
            <div className="rounded-lg bg-muted/40 border border-border p-3 mb-5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Emails come from <strong className="text-foreground">Spliiit</strong>, not from you — so there's no awkwardness. Reminders are sent at most once per person per time frame.
              </p>
            </div>

            <Button
              className="w-full mb-4"
              size="lg"
              onClick={() => saveReminderMutation.mutate({ reminderEnabled, reminderDays, reminderTone })}
              disabled={saveReminderMutation.isPending}
            >
              {saveReminderMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
              ) : (
                "Save Settings"
              )}
            </Button>
          </div>
        )}

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
              a: "Tap the sun/moon icon at the top right of the home page — it's just to the left of the logout button. Tap it to toggle between light and dark mode.",
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
