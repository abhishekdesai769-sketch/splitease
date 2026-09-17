import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { shareLink } from "@/lib/share";

/**
 * ShareChannels — the one canonical invite UI, reused everywhere we ask a user
 * to share a link (app referral in the drawer, Add-a-Friend, group invite).
 *
 * A copy-link chip on top + a monochrome-ink channel grid: WhatsApp · Telegram
 * · X · SMS · Email · More. Every channel here supports a PRE-FILLED message
 * via a plain URL scheme (no SDKs, no cost). "More" opens the native OS share
 * sheet, which covers Instagram / Snapchat / TikTok / AirDrop / anything else
 * installed — those platforms have no pre-fill URL, so the system sheet is the
 * only way to reach them.
 */

interface ShareChannelsProps {
  /** The link being shared (referral or group invite). */
  url: string;
  /** The pre-filled message, WITHOUT the url (we append it per channel). */
  text: string;
  /** Subject line for the email channel. */
  emailSubject?: string;
}

const TILE =
  "flex flex-col items-center gap-1.5 group";
const ICON_WRAP =
  "w-14 h-14 rounded-2xl border border-border bg-card flex items-center justify-center text-foreground transition-colors group-hover:bg-muted/60 group-active:bg-muted";
const LABEL = "text-[11px] font-medium text-muted-foreground";

export function ShareChannels({ url, text, emailSubject = "Join me on Spliiit" }: ShareChannelsProps) {
  const [copied, setCopied] = useState(false);
  const combined = `${text} ${url}`;

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const el = document.createElement("textarea");
        el.value = url;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* no-op */
    }
  };

  // Display form of the url (drop the protocol for a cleaner chip).
  const displayUrl = url.replace(/^https?:\/\//, "");

  return (
    <div className="space-y-4">
      {/* Copy-link chip */}
      <button
        type="button"
        onClick={handleCopy}
        className="w-full flex items-center gap-3 bg-card border border-border rounded-xl px-3.5 py-3 text-left hover:bg-muted/50 transition-colors"
        data-testid="share-copy-link"
      >
        <span className="flex-1 font-mono text-xs text-muted-foreground truncate">{displayUrl}</span>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-accent-foreground shrink-0">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? "Copied" : "Copy"}
        </span>
      </button>

      {/* Channel grid — monochrome ink, one system. */}
      <div className="grid grid-cols-3 gap-x-2 gap-y-3">
        {/* WhatsApp */}
        <a className={TILE} href={`https://wa.me/?text=${encodeURIComponent(combined)}`} target="_blank" rel="noopener noreferrer" data-testid="share-whatsapp">
          <span className={ICON_WRAP}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2z" />
              <path d="M8.6 8.4c-.3 0-.6.1-.8.4-.3.3-.9.9-.9 2.1s.9 2.5 1 2.6c.1.2 1.8 2.9 4.5 3.9 2.2.9 2.7.7 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2-.1-.1-.3-.2-.6-.3l-1.4-.7c-.2-.1-.4-.1-.6.1l-.6.8c-.1.2-.3.2-.5.1-.7-.3-1.4-.6-2.3-1.6-.3-.4-.6-.9-.7-1.1-.1-.2 0-.3.1-.4l.4-.5c.1-.2.1-.3 0-.5l-.7-1.6c-.2-.4-.4-.4-.6-.4z" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className={LABEL}>WhatsApp</span>
        </a>

        {/* Telegram */}
        <a className={TILE} href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" data-testid="share-telegram">
          <span className={ICON_WRAP}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 4.3 2.9 11.2c-.6.2-.6 1 0 1.2l4.6 1.5 1.8 5.3c.2.5.8.6 1.2.2l2.5-2.4 4.6 3.4c.4.3 1 .1 1.1-.4L22.3 5c.1-.6-.4-1-.8-.7z" />
              <path d="M8.1 13.9 16 8.2l-5.9 6.3" />
            </svg>
          </span>
          <span className={LABEL}>Telegram</span>
        </a>

        {/* X */}
        <a className={TILE} href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" data-testid="share-x">
          <span className={ICON_WRAP}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
              <path d="M18.9 2h3.3l-7.2 8.2L23.6 22h-6.7l-5.2-6.9L5.6 22H2.3l7.7-8.8L2.1 2h6.8l4.7 6.3L18.9 2zm-1.2 18h1.8L7.1 3.9H5.2L17.7 20z" />
            </svg>
          </span>
          <span className={LABEL}>X</span>
        </a>

        {/* SMS */}
        <a className={TILE} href={`sms:?&body=${encodeURIComponent(combined)}`} data-testid="share-sms">
          <span className={ICON_WRAP}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.4 7.5 0 0 1-12.5 6.6L3 20l1.9-4.9A8.4 7.5 0 1 1 21 11.5z" />
            </svg>
          </span>
          <span className={LABEL}>Text</span>
        </a>

        {/* Email */}
        <a className={TILE} href={`mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(combined)}`} data-testid="share-email">
          <span className={ICON_WRAP}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
          </span>
          <span className={LABEL}>Email</span>
        </a>

        {/* More — native OS share sheet (IG / Snap / TikTok / etc.) */}
        <button type="button" className={TILE} onClick={() => shareLink({ title: emailSubject, text, url })} data-testid="share-more">
          <span className={ICON_WRAP}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="18" cy="5" r="2.4" />
              <circle cx="6" cy="12" r="2.4" />
              <circle cx="18" cy="19" r="2.4" />
              <path d="m8.1 10.8 7.4-4.4M8.1 13.2l7.4 4.4" />
            </svg>
          </span>
          <span className={LABEL}>More</span>
        </button>
      </div>
    </div>
  );
}
