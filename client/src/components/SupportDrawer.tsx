import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { NotificationSettings } from "@/components/NotificationSettings";
import { DrawerHome, AccountView } from "@/components/DrawerMenu";
import {
  PaymentScreen,
  RemindersScreen,
  FaqScreen,
  SupportScreen,
  InviteScreen,
  DeleteAccountScreen,
} from "@/components/DrawerScreens";

// The left menu drawer. This file is the shell: the Sheet, which screen is
// showing, and the account-deletion call. The screens themselves live in
// DrawerMenu.tsx (home + Account) and DrawerScreens.tsx (everything behind a
// row), plus NotificationSettings.tsx.

type View =
  | "menu" | "account" | "payment" | "reminders" | "notifications"
  | "faq" | "support" | "invite" | "delete";

export function SupportDrawer({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  // Where Contact support's back button returns to (menu, or FAQs' "Still stuck?").
  const [supportFrom, setSupportFrom] = useState<View>("menu");
  const [isDeleting, setIsDeleting] = useState(false);

  // Deep-link hook: the "What's New" carousel (and any other surface) can
  // open this drawer straight to the payment editor by dispatching this
  // custom event. Decoupled — no DOM targeting, no prop drilling.
  useEffect(() => {
    const openPayment = () => { setView("payment"); setOpen(true); };
    window.addEventListener("spliiit:open-payment-prefs", openPayment);
    return () => window.removeEventListener("spliiit:open-payment-prefs", openPayment);
  }, []);

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
      toast({ title: "Couldn't delete your account", description: parsed, variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    // Back to the menu after the closing animation, so the next open starts fresh.
    if (!isOpen) setTimeout(() => setView("menu"), 300);
  };

  const toMenu = () => setView("menu");
  const openSupport = (from: View) => { setSupportFrom(from); setView("support"); };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        {children}
      </SheetTrigger>
      <SheetContent
        side="left"
        // On close, Radix restores focus to the trigger (the header logo
        // button). On WebKit/iOS that paints a default blue focus outline
        // that lingers around the logo until you tap elsewhere — looks like
        // a stuck highlight even though nothing was clicked. Preventing the
        // close-auto-focus stops the ring from ever landing there. Keyboard
        // users still get focus-visible rings on the controls themselves.
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Same WebKit issue on open: Radix focuses the first button (the name
        // row) and iOS paints a blue box around it. Keep focus on the trigger.
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Paper-on-beige drawer: rounded outer edge + the same soft shadow as
        // the quick-add card, over a softened (not blacked-out) app.
        className="w-[85vw] max-w-[330px] sm:w-[360px] sm:max-w-[360px] flex flex-col gap-0 p-0 bg-sidebar border-0 rounded-r-[28px] shadow-[0_18px_48px_-16px_rgba(40,30,20,0.35)]"
        overlayClassName="bg-background/70 backdrop-blur-[3px]"
        hideClose
        // Inline style because p-0 above zeros out the sheet variant's
        // padding (CSS shorthand vs longhand source-order resolution makes
        // class-based safe-area unreliable when there's also a `p-0`).
        // Inline styles always beat class declarations, so this is robust.
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Title for screen readers — the visible top of the drawer is the name row. */}
        <SheetHeader className="sr-only">
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>

        {view === "menu" && (
          <DrawerHome
            onAccount={() => setView("account")}
            onPayment={() => setView("payment")}
            onReminders={() => setView("reminders")}
            onNotifications={() => setView("notifications")}
            onImport={() => { setOpen(false); setLocation("/import"); }}
            onFaq={() => setView("faq")}
            onSupport={() => openSupport("menu")}
            onInvite={() => setView("invite")}
          />
        )}

        {view === "account" && (
          <AccountView onBack={toMenu} onDelete={() => setView("delete")} />
        )}

        {view === "payment" && <PaymentScreen onBack={toMenu} />}
        {view === "reminders" && <RemindersScreen onBack={toMenu} />}
        {view === "notifications" && <NotificationSettings onBack={toMenu} />}
        {view === "faq" && <FaqScreen onBack={toMenu} onSupport={() => openSupport("faq")} />}
        {view === "support" && (
          <SupportScreen
            onBack={() => setView(supportFrom)}
            backLabel={supportFrom === "faq" ? "FAQs" : "Menu"}
            onDone={toMenu}
          />
        )}
        {view === "invite" && <InviteScreen onBack={toMenu} />}
        {view === "delete" && (
          <DeleteAccountScreen
            onBack={() => setView("account")}
            onConfirm={handleDeleteAccount}
            deleting={isDeleting}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
