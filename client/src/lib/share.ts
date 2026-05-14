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

/**
 * Share an invite link to a Spliiit group.
 * Always returns a typed result — never throws.
 */
export async function shareInviteLink(opts: ShareInviteOptions): Promise<ShareResult> {
  const { groupName, inviterName, url } = opts;
  const title = `Join "${groupName}" on Spliiit`;
  const text = `${inviterName} invited you to split expenses in "${groupName}". Tap the link to join — takes 30 seconds.`;

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

  // Clipboard fallback
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
