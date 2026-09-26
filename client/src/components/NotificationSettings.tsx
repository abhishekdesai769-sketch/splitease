import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getPushPermissionStatus, requestPushPermission, type PushPermissionStatus } from "@/lib/push";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefKey,
  type NotificationPrefs,
} from "@shared/notificationPrefs";

// Menu → Notifications. One switch per kind of message, all ON by default.
// Styled in the newer app language (paper groups on the drawer's beige,
// Instrument Serif title, no hairlines) — see the Spliiit prototype.

const QUERY_KEY = ["/api/user/notification-prefs"];

type Row = { key: NotificationPrefKey; title: string; channel: string; sub: string };

const GROUPS: { label: string; rows: Row[] }[] = [
  {
    label: "Money",
    rows: [
      { key: "newExpenses", title: "New expenses", channel: "Push", sub: "Someone adds an expense with you" },
      { key: "settleUps", title: "Settle-ups", channel: "Push", sub: "Someone pays you back" },
      { key: "deletedExpenses", title: "Deleted expenses", channel: "Push", sub: "Someone deletes an expense you're in" },
      { key: "emailCopies", title: "Email copies", channel: "Email", sub: "Receipts and settle-ups, for your records" },
    ],
  },
  {
    label: "Groups",
    rows: [
      { key: "groupActivity", title: "Group activity", channel: "Push", sub: "You're added to a group, or someone joins yours" },
    ],
  },
  {
    label: "From Spliiit",
    rows: [
      { key: "weeklyBalance", title: "Weekly balance", channel: "Push", sub: "Only when people owe you" },
      { key: "news", title: "News and updates", channel: "Email and push", sub: "New features and announcements" },
    ],
  },
];

export function NotificationSettings({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [permission, setPermission] = useState<PushPermissionStatus>("unsupported");

  const { data: prefs = DEFAULT_NOTIFICATION_PREFS } = useQuery<NotificationPrefs>({
    queryKey: QUERY_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/user/notification-prefs")).json(),
    staleTime: 60 * 1000,
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<NotificationPrefs>) =>
      (await apiRequest("PATCH", "/api/user/notification-prefs", patch)).json() as Promise<NotificationPrefs>,
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<NotificationPrefs>(QUERY_KEY);
      queryClient.setQueryData<NotificationPrefs>(QUERY_KEY, { ...(previous ?? DEFAULT_NOTIFICATION_PREFS), ...patch });
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(QUERY_KEY, ctx.previous);
      toast({ title: "Couldn't save that", description: "Check your connection and try again.", variant: "destructive" });
    },
    onSuccess: (next) => queryClient.setQueryData(QUERY_KEY, next),
  });

  // iOS permission — re-checked when the app comes back from Settings.
  useEffect(() => {
    let alive = true;
    const check = () => getPushPermissionStatus().then((s) => alive && setPermission(s));
    check();
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const turnOnPush = async () => {
    if (permission === "prompt") {
      setPermission(await requestPushPermission());
      return;
    }
    // Declined before: iOS never re-prompts, so open Spliiit's page in Settings.
    try { window.open("app-settings:", "_system"); } catch { /* no-op */ }
  };

  const showBanner = permission === "denied" || permission === "prompt";

  return (
    <div className="flex-1 flex flex-col px-4 overflow-y-auto pb-8" data-testid="notification-settings">
      <button
        onClick={onBack}
        className="text-xs text-muted-foreground hover:text-foreground mb-3 self-start flex-shrink-0 px-1"
      >
        ← Back
      </button>

      <h3 className="font-serif text-[34px] leading-none text-foreground mb-5 px-1">Notifications</h3>

      {showBanner && (
        <div className="flex items-center gap-3 rounded-[20px] bg-accent px-4 py-3.5 mb-5" data-testid="push-off-banner">
          <BellOff className="w-5 h-5 text-accent-foreground flex-shrink-0" />
          <p className="flex-1 text-sm leading-snug text-foreground">
            {permission === "denied"
              ? "Notifications are off for Spliiit on this iPhone"
              : "Notifications aren't turned on yet"}
          </p>
          <button onClick={turnOnPush} className="text-sm font-medium text-accent-foreground py-2">
            Turn on
          </button>
        </div>
      )}

      {GROUPS.map((group) => (
        <div key={group.label} className="mb-4">
          <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground px-3.5 pb-2">{group.label}</p>
          <div className="rounded-[22px] bg-card py-1">
            {group.rows.map((row) => (
              <label
                key={row.key}
                htmlFor={`notif-${row.key}`}
                className="flex items-center gap-3 px-4 py-3 min-h-[52px] cursor-pointer"
              >
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[15px] text-foreground">{row.title}</span>
                    <span className="text-[11px] text-muted-foreground bg-muted/60 rounded-full px-2 py-0.5">{row.channel}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground leading-snug mt-0.5">{row.sub}</span>
                </span>
                <Switch
                  id={`notif-${row.key}`}
                  checked={prefs[row.key]}
                  onCheckedChange={(checked) => save.mutate({ [row.key]: checked })}
                  data-testid={`switch-${row.key}`}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
