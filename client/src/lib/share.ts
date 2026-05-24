/**
 * Cross-platform share helper.
 *
 * Uses the Web Share API (navigator.share) when available — works inside iOS
 * Capacitor's WKWebView, Chrome on Android (TWA + standalone), Edge, and Safari.
 * Falls back to clipboard.writeText() on browsers without share support
 * (desktop Firefox, older Chrome on desktop).
 *
 * Why not @capacitor/share? Web Share API works in WKWebView, so the native
 * plugin would just add 200kb of pod for no behavioral difference. If we ever
 * need to share files/images on iOS we can revisit.
 */

export type ShareMethod = "native_share" | "clipboard" | "cancelled" | "error";

export interface ShareResult {
  method: ShareMethod;
}

export interface ShareInviteOptions {
  groupName: string;
  inviterName: string;
  url: string;
}

export interface ShareLinkOptions {
  /** Title — used by some share targets (e.g., email subject). */
  title: string;
  /** Body text — pre-filled in WhatsApp/iMessage/IG-DM/etc. */
  text: string;
  /** The URL itself — appended to text by most share targets. */
  url: string;
}

/**
 * Generic shareable link — used by every "invite" flow in the app
 * (group share, friend invite, "tell a friend about Spliiit", referral).
 *
 * Behavior:
 *  - Web Share API if available → triggers OS share sheet (IG, WhatsApp,
 *    iMessage, AirDrop, email, Signal, Telegram, etc. — one tap to any)
 *  - Falls back to clipboard.writeText if no share API
 *  - Legacy execCommand("copy") fallback for ancient browsers
 *  - Returns typed result, never throws
 */
export async function shareLink(opts: ShareLinkOptions): Promise<ShareResult> {
  const { title, text, url } = opts;

  // Try native Web Share API first
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url });
      return { method: "native_share" };
    } catch (err: any) {
      // User cancelled the share sheet — not an error
      if (err?.name === "AbortError") return { method: "cancelled" };
      // Some browsers throw NotAllowedError if not triggered by a user gesture —
      // fall through to clipboard rather than failing.
      // Any other error → fall through to clipboard, don't surface to user.
    }
  }

  // Clipboard fallback — copy the URL only (not the message text) since the
  // user will paste this wherever they want and write their own message.
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return { method: "clipboard" };
    }
    // Legacy fallback for browsers without clipboard API
    const textarea = document.createElement("textarea");
    textarea.value = url;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return { method: "clipboard" };
  } catch {
    return { method: "error" };
  }
}

/**
 * Share an invite link to a Spliiit group. Thin wrapper around shareLink
 * with group-specific pre-formatted copy.
 */
export async function shareInviteLink(opts: ShareInviteOptions): Promise<ShareResult> {
  const { groupName, inviterName, url } = opts;
  return shareLink({
    title: `Join "${groupName}" on Spliiit`,
    text: `${inviterName} invited you to split expenses in "${groupName}". Tap the link to join — takes 30 seconds.`,
    url,
  });
}

/**
 * "Tell a friend about Spliiit" — referral-style share with a personal CTA.
 * Used by the friend-invite and "share the app" flows.
 */
export interface ShareAppOptions {
  /** The sender's display name (used in the message text). */
  inviterName: string;
  /** Optional referral code — appended as ?ref=CODE so signups get attributed. */
  referralCode?: string | null;
  /** Optional override of the destination URL (defaults to the app's homepage). */
  baseUrl?: string;
}

export async function shareAppLink(opts: ShareAppOptions): Promise<ShareResult> {
  const { inviterName, referralCode, baseUrl } = opts;
  const root = baseUrl || "https://spliiit.klarityit.ca";
  const url = referralCode ? `${root}?ref=${referralCode}` : root;
  return shareLink({
    title: "Spliiit — split expenses with friends",
    text: `Hey, ${inviterName} here. I use Spliiit to split expenses with friends — it's free with no limits. Join me:`,
    url,
  });
}
