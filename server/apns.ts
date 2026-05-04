/**
 * APNs (Apple Push Notification service) HTTP/2 sender.
 *
 * Token-based auth using a .p8 signing key from Apple Developer.
 *
 * Required env vars (all 4 must be set or APNs is disabled — graceful no-op):
 *   APNS_KEY        Contents of the .p8 file. Newlines may be encoded as `\n`
 *                   in env vars; we unescape them on read.
 *   APNS_KEY_ID     10-char Key ID from Apple Developer (e.g. "ABC123DEF4")
 *   APNS_TEAM_ID    10-char Team ID from Apple Developer (Membership tab)
 *   APNS_BUNDLE_ID  iOS bundle identifier (e.g. "ca.klarityit.spliiit")
 *
 * Optional:
 *   APNS_DEFAULT_ENV  "production" (default) or "sandbox" — used as fallback
 *                     when a device token row has no environment recorded.
 *
 * Per-token environment routing: each device_tokens row carries its own
 * `environment` field. TestFlight installs typically register with "sandbox",
 * App Store installs with "production". We maintain two ApnsClient instances
 * (one per host) and route by the token's environment, so a single deployment
 * can serve both TestFlight testers and App Store users simultaneously.
 *
 * If APNs is misconfigured or env vars are missing, every send is a silent
 * no-op — by design, so push failures never break expense creation flows.
 */

import { ApnsClient, Notification } from "apns2";

const APNS_KEY_RAW   = process.env.APNS_KEY;
const APNS_KEY_ID    = process.env.APNS_KEY_ID;
const APNS_TEAM_ID   = process.env.APNS_TEAM_ID;
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID;
const APNS_DEFAULT_ENV = (process.env.APNS_DEFAULT_ENV as "production" | "sandbox") || "production";

export const APNS_ENABLED = !!(APNS_KEY_RAW && APNS_KEY_ID && APNS_TEAM_ID && APNS_BUNDLE_ID);

if (!APNS_ENABLED) {
  console.warn("[apns] APNS_* env vars not fully set — push notifications disabled (graceful no-op)");
}

// Render and other hosting providers often replace newlines in env vars with
// the literal string `\n`. Restore real newlines so the PEM key parses.
const signingKey = APNS_KEY_RAW ? APNS_KEY_RAW.replace(/\\n/g, "\n") : "";

let _prodClient: ApnsClient | null = null;
let _sandboxClient: ApnsClient | null = null;

function getClient(environment: "production" | "sandbox"): ApnsClient | null {
  if (!APNS_ENABLED) return null;
  try {
    if (environment === "sandbox") {
      if (!_sandboxClient) {
        _sandboxClient = new ApnsClient({
          team: APNS_TEAM_ID!,
          keyId: APNS_KEY_ID!,
          signingKey,
          defaultTopic: APNS_BUNDLE_ID!,
          host: "api.sandbox.push.apple.com",
          requestTimeout: 10_000,
        });
      }
      return _sandboxClient;
    }
    if (!_prodClient) {
      _prodClient = new ApnsClient({
        team: APNS_TEAM_ID!,
        keyId: APNS_KEY_ID!,
        signingKey,
        defaultTopic: APNS_BUNDLE_ID!,
        host: "api.push.apple.com",
        requestTimeout: 10_000,
      });
    }
    return _prodClient;
  } catch (err) {
    console.error("[apns] failed to construct client:", err);
    return null;
  }
}

export interface ApnsPayload {
  /** Lock-screen / banner title (top line, bold). */
  title: string;
  /** Body text shown under the title. */
  body: string;
  /** Optional subtitle (smaller line above body on iOS). */
  subtitle?: string;
  /** Group multiple notifications by topic on the lock screen (e.g. group name). */
  threadId?: string;
  /** Custom data delivered to the app when the user taps the push. */
  data?: Record<string, unknown>;
  /** Sound. Defaults to "default" — pass undefined for silent. */
  sound?: string | undefined;
  /** Optional badge count. */
  badge?: number;
}

export interface ApnsTokenRef {
  token: string;
  environment: "production" | "sandbox";
}

export interface ApnsSendResult {
  ok: boolean;
  reason?: string;
  /** True if APNs reports the token is dead and we should delete it. */
  invalidToken?: boolean;
}

const INVALID_TOKEN_REASONS = new Set([
  "Unregistered",
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
  "ExpiredToken",
  "TopicDisallowed",
]);

/** Send a push to one device token. Never throws. */
export async function sendApnsPush(ref: ApnsTokenRef, payload: ApnsPayload): Promise<ApnsSendResult> {
  const client = getClient(ref.environment || APNS_DEFAULT_ENV);
  if (!client) return { ok: false, reason: "APNs not configured" };

  try {
    const notification = new Notification(ref.token, {
      alert: { title: payload.title, body: payload.body, ...(payload.subtitle ? { subtitle: payload.subtitle } : {}) },
      sound: payload.sound === undefined ? "default" : payload.sound,
      badge: payload.badge,
      threadId: payload.threadId,
      data: payload.data ?? {},
    });
    await client.send(notification);
    return { ok: true };
  } catch (err: any) {
    const reason = err?.reason || err?.message || "unknown";
    const invalidToken = INVALID_TOKEN_REASONS.has(reason);
    // Don't log "invalid token" cases as errors — they're expected lifecycle events
    if (invalidToken) {
      console.log(`[apns] token ${ref.token.slice(0, 8)}… is invalid (${reason}) — will be cleaned up`);
    } else {
      console.error(`[apns] send failed for ${ref.token.slice(0, 8)}…:`, reason);
    }
    return { ok: false, reason, invalidToken };
  }
}

/** Send the same payload to many tokens. Never throws. */
export async function sendApnsBatch(
  tokens: ApnsTokenRef[],
  payload: ApnsPayload,
): Promise<{ sent: number; invalidTokens: string[] }> {
  if (!APNS_ENABLED || tokens.length === 0) return { sent: 0, invalidTokens: [] };
  const results = await Promise.all(
    tokens.map((ref) => sendApnsPush(ref, payload).then((r) => ({ token: ref.token, ...r }))),
  );
  return {
    sent: results.filter((r) => r.ok).length,
    invalidTokens: results.filter((r) => r.invalidToken).map((r) => r.token),
  };
}
