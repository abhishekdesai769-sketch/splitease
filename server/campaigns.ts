// server/campaigns.ts
//
// One-off broadcast campaigns — milestone celebrations, product announcements,
// special offers. Multi-channel: email + iOS push + Premium grant + in-app
// banner state. Idempotent via the campaign_sends audit table — re-running a
// campaign skips users already sent that channel.
//
// USAGE
//   - Define a campaign config in CAMPAIGNS below.
//   - Admin triggers via POST /api/admin/campaigns/run with { campaignId, dryRun }.
//   - dryRun=true returns audience counts only (no side effects).
//   - dryRun=false sends to every user not already sent (per channel).
//   - The campaign_sends table guarantees no double-sends across retries.

import { Resend } from "resend";
import { db } from "./db";
import {
  users,
  campaignSends,
  deviceTokens,
} from "@shared/schema";
import { eq, and, ne, inArray, sql, isNotNull } from "drizzle-orm";
import { sendApnsBatch, APNS_ENABLED } from "./apns";
import type { User } from "@shared/schema";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_ADDRESS = "Spliiit <spliiit@klarityit.ca>";

// ─── Campaign registry ───────────────────────────────────────────────────

export type CampaignChannel = "email" | "ios_push" | "premium_grant" | "banner_seen";

export interface CampaignConfig {
  id: string;
  enabled: boolean;
  description: string;
  // Audience filters — applied BEFORE any channel is considered
  audience: {
    excludeCurrencies: string[];     // e.g. ["INR"]
    iosOnly: boolean;                // when true, all channels (email/push/grant/banner)
                                     // skip users without an iOS device token
  };
  // Channels to fire — each can be enabled independently
  channels: {
    email: boolean;
    iosPush: boolean;
    premiumGrant: { enabled: boolean; durationDays: number };  // iOS users only by nature
    inAppBanner: boolean;
  };
  // Copy
  email: {
    subject: string;
    htmlBody: (user: User) => string;   // function so we can interpolate user name
    textBody: (user: User) => string;
  };
  iosPush: {
    title: string;
    body: string;
  };
  banner: {
    title: string;
    message: string;
    ctaLabel: string;
    ctaPath: string;                    // hash route, e.g. "/ai"
  };
}

// The active campaign — June 2026 milestone thank-you.
//
// Behaviour:
//   - Email to all users not in excludeCurrencies
//   - iOS push to all iOS users not in excludeCurrencies
//   - 30-day Premium grant to all iOS users not in excludeCurrencies
//   - In-app banner shown once on next app open to ALL users not excluded
//
// Disabled by default — flip ENABLED=true and deploy, then trigger from /admin.
export const CAMPAIGN_1K: CampaignConfig = {
  id: "milestone_1k_2026_06",
  enabled: process.env.CAMPAIGN_1K_ENABLED === "true",
  description: "1,000-user milestone thank-you (June 2026) — iOS only",
  audience: {
    excludeCurrencies: ["INR"],
    iosOnly: true,                   // Skip web + Android entirely
  },
  channels: {
    email: true,
    iosPush: true,
    premiumGrant: { enabled: true, durationDays: 30 },
    inAppBanner: true,
  },
  email: {
    subject: "We just hit 1,000 users — and you're one of them",
    htmlBody: (user) => milestone1kEmailHtml(user.name),
    textBody: (user) => milestone1kEmailText(user.name),
  },
  iosPush: {
    title: "Spliiit hit 1,000 users",
    body: "You just got Premium free for 30 days. Tap to unlock AI Mode.",
  },
  banner: {
    title: "Thanks for being one of our first 1,000",
    message: "Premium unlocked free for 30 days — try AI Mode.",
    ctaLabel: "Try AI Mode",
    ctaPath: "/ai",
  },
};

const CAMPAIGNS: Record<string, CampaignConfig> = {
  [CAMPAIGN_1K.id]: CAMPAIGN_1K,
};

export function getCampaign(campaignId: string): CampaignConfig | null {
  return CAMPAIGNS[campaignId] || null;
}

// ─── Audience segmentation ───────────────────────────────────────────────

export interface AudienceCounts {
  totalEligible: number;       // users not in excluded currencies
  iosUsers: number;            // subset with an iOS device token
  excludedByCurrency: number;  // for context
  alreadySentEmail: number;    // would skip on live run
  alreadySentPush: number;
  alreadyGrantedPremium: number;
}

export interface AudienceUser {
  id: string;
  name: string;
  email: string;
  defaultCurrency: string | null;
  isPremium: boolean;
  premiumUntil: string | null;
  hasIosToken: boolean;
}

async function getAudience(config: CampaignConfig): Promise<AudienceUser[]> {
  // All approved, non-deleted users (excluding the excluded currencies).
  // We don't filter on isPremium here — Premium users still get the email +
  // banner; the grant step will just skip them since they're already Premium.
  const allUsers = await db.select().from(users);

  // Map iOS-token existence per user. One query, one map lookup per user.
  const iosTokens = await db
    .selectDistinct({ userId: deviceTokens.userId })
    .from(deviceTokens)
    .where(eq(deviceTokens.platform, "ios"));
  const iosUserSet = new Set(iosTokens.map((t) => t.userId));

  return allUsers
    .filter((u) => {
      // Exclude soft-deleted users (if column exists)
      if ((u as any).deletedAt) return false;
      // Exclude requested currencies
      const cur = (u.defaultCurrency || "").toUpperCase();
      if (config.audience.excludeCurrencies.includes(cur)) return false;
      // Must have an email to receive anything meaningful
      if (!u.email) return false;
      // iOS-only campaigns: skip everyone without an APNs token. This is the
      // master gate — applies to email + push + banner + grant uniformly.
      if (config.audience.iosOnly && !iosUserSet.has(u.id)) return false;
      return true;
    })
    .map((u) => ({
      id: u.id,
      name: u.name || "there",
      email: u.email,
      defaultCurrency: u.defaultCurrency,
      isPremium: !!u.isPremium,
      premiumUntil: u.premiumUntil,
      hasIosToken: iosUserSet.has(u.id),
    }));
}

export async function getAudienceCounts(config: CampaignConfig): Promise<AudienceCounts> {
  const audience = await getAudience(config);
  const allUsers = await db.select({ defaultCurrency: users.defaultCurrency }).from(users);
  const excludedByCurrency = allUsers.filter((u) =>
    config.audience.excludeCurrencies.includes((u.defaultCurrency || "").toUpperCase()),
  ).length;

  // Already-sent counts per channel
  const sent = await db
    .select({ userId: campaignSends.userId, channel: campaignSends.channel })
    .from(campaignSends)
    .where(and(eq(campaignSends.campaignId, config.id), eq(campaignSends.success, true)));

  const sentEmail = new Set(sent.filter((s) => s.channel === "email").map((s) => s.userId));
  const sentPush = new Set(sent.filter((s) => s.channel === "ios_push").map((s) => s.userId));
  const grantedPremium = new Set(
    sent.filter((s) => s.channel === "premium_grant").map((s) => s.userId),
  );

  return {
    totalEligible: audience.length,
    iosUsers: audience.filter((u) => u.hasIosToken).length,
    excludedByCurrency,
    alreadySentEmail: audience.filter((u) => sentEmail.has(u.id)).length,
    alreadySentPush: audience.filter((u) => u.hasIosToken && sentPush.has(u.id)).length,
    alreadyGrantedPremium: audience.filter((u) => u.hasIosToken && grantedPremium.has(u.id)).length,
  };
}

// ─── Idempotency helpers ─────────────────────────────────────────────────

async function alreadySent(userId: string, campaignId: string, channel: CampaignChannel): Promise<boolean> {
  const [row] = await db
    .select()
    .from(campaignSends)
    .where(
      and(
        eq(campaignSends.userId, userId),
        eq(campaignSends.campaignId, campaignId),
        eq(campaignSends.channel, channel),
        eq(campaignSends.success, true),
      ),
    )
    .limit(1);
  return !!row;
}

async function recordSend(
  userId: string,
  campaignId: string,
  channel: CampaignChannel,
  success: boolean,
  errorMessage: string | null = null,
) {
  // INSERT … ON CONFLICT DO UPDATE — if a failed send is being retried, flip
  // success to true (or remain on failure). The unique index on
  // (user_id, campaign_id, channel) guarantees one row per combo.
  await db.execute(sql`
    INSERT INTO campaign_sends (user_id, campaign_id, channel, sent_at, success, error_message)
    VALUES (${userId}, ${campaignId}, ${channel}, ${new Date().toISOString()}, ${success}, ${errorMessage})
    ON CONFLICT (user_id, campaign_id, channel) DO UPDATE SET
      sent_at = EXCLUDED.sent_at,
      success = EXCLUDED.success,
      error_message = EXCLUDED.error_message
  `);
}

// ─── Banner — per-user "unviewed campaigns" API ──────────────────────────

/**
 * Get the active campaign banner for a user (if any). Called on every app
 * open via /api/user/campaigns/active. Returns null if user has already
 * dismissed it, or the campaign isn't enabled, or the user isn't in the
 * audience, or the campaign has no banner channel.
 */
export async function getActiveBannerForUser(userId: string): Promise<{
  campaignId: string;
  title: string;
  message: string;
  ctaLabel: string;
  ctaPath: string;
} | null> {
  for (const cfg of Object.values(CAMPAIGNS)) {
    if (!cfg.enabled || !cfg.channels.inAppBanner) continue;

    // Has this user already dismissed this campaign's banner?
    const dismissed = await alreadySent(userId, cfg.id, "banner_seen");
    if (dismissed) continue;

    // Is this user in the audience? (Re-check the currency filter — user
    // could have changed defaultCurrency since the campaign was triggered.)
    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!u) continue;
    const cur = (u.defaultCurrency || "").toUpperCase();
    if (cfg.audience.excludeCurrencies.includes(cur)) continue;

    // iOS-only campaigns: hide banner from web/Android users. Same gate as
    // every other channel — keeps the audience definition consistent.
    if (cfg.audience.iosOnly) {
      const [iosToken] = await db
        .select()
        .from(deviceTokens)
        .where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.platform, "ios")))
        .limit(1);
      if (!iosToken) continue;
    }

    return {
      campaignId: cfg.id,
      title: cfg.banner.title,
      message: cfg.banner.message,
      ctaLabel: cfg.banner.ctaLabel,
      ctaPath: cfg.banner.ctaPath,
    };
  }
  return null;
}

export async function dismissBanner(userId: string, campaignId: string): Promise<void> {
  await recordSend(userId, campaignId, "banner_seen", true);
}

// ─── Main runner ─────────────────────────────────────────────────────────

export interface RunReport {
  campaignId: string;
  dryRun: boolean;
  audience: AudienceCounts;
  results: {
    emailSent: number;
    emailSkipped: number;
    emailFailed: number;
    pushSent: number;
    pushSkipped: number;
    pushFailed: number;
    premiumGranted: number;
    premiumSkipped: number;
    premiumFailed: number;
  };
  startedAt: string;
  finishedAt: string;
}

/**
 * Run a campaign. If dryRun=true, returns audience counts but does NOT send
 * anything. If dryRun=false, sends through all enabled channels to all
 * eligible users not already sent (per channel).
 *
 * Resilient: a failure on one channel for one user is logged in the audit
 * row and does NOT abort the rest of the campaign. Re-running the campaign
 * will retry failures (they're recorded with success=false and the unique
 * index allows the UPSERT to flip them).
 */
export async function runCampaign(
  campaignId: string,
  opts: { dryRun: boolean },
): Promise<RunReport> {
  const cfg = getCampaign(campaignId);
  if (!cfg) throw new Error(`Unknown campaign: ${campaignId}`);
  if (!cfg.enabled && !opts.dryRun) {
    throw new Error(`Campaign ${campaignId} is disabled. Set CAMPAIGN_1K_ENABLED=true on Render and redeploy.`);
  }

  const startedAt = new Date().toISOString();
  const audience = await getAudienceCounts(cfg);
  const result: RunReport["results"] = {
    emailSent: 0, emailSkipped: 0, emailFailed: 0,
    pushSent: 0, pushSkipped: 0, pushFailed: 0,
    premiumGranted: 0, premiumSkipped: 0, premiumFailed: 0,
  };

  if (opts.dryRun) {
    return {
      campaignId,
      dryRun: true,
      audience,
      results: result,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const eligible = await getAudience(cfg);

  // ── Email — fan out with a small batch delay to avoid Resend rate limits.
  // Resend's free tier is 100/day with bursts of ~10/sec. We process serially
  // with a 50ms delay = 20/sec max. For 1000 users this is ~50 seconds total.
  if (cfg.channels.email && resend) {
    for (const u of eligible) {
      if (await alreadySent(u.id, cfg.id, "email")) {
        result.emailSkipped++;
        continue;
      }
      try {
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: u.email,
          subject: cfg.email.subject,
          html: cfg.email.htmlBody(u as unknown as User),
          text: cfg.email.textBody(u as unknown as User),
          replyTo: "spliiit@klarityit.ca",  // milestone email is OK to reply to
        });
        await recordSend(u.id, cfg.id, "email", true);
        result.emailSent++;
      } catch (err: any) {
        console.error(`[campaign:${cfg.id}] email failed for ${u.email}:`, err);
        await recordSend(u.id, cfg.id, "email", false, err?.message || "send_failed");
        result.emailFailed++;
      }
      await sleep(50);  // 20/sec throttle
    }
  }

  // ── iOS push — only to users with iOS tokens, batched via existing APNs lib
  if (cfg.channels.iosPush && APNS_ENABLED) {
    const iosEligible = eligible.filter((u) => u.hasIosToken);
    for (const u of iosEligible) {
      if (await alreadySent(u.id, cfg.id, "ios_push")) {
        result.pushSkipped++;
        continue;
      }
      try {
        const tokens = await db
          .select()
          .from(deviceTokens)
          .where(and(eq(deviceTokens.userId, u.id), eq(deviceTokens.platform, "ios")));
        if (tokens.length === 0) {
          result.pushSkipped++;
          continue;
        }
        const tokenRefs = tokens.map((t) => ({
          token: t.token,
          environment: (t.environment as "production" | "sandbox") || "production",
        }));
        await sendApnsBatch(tokenRefs, {
          title: cfg.iosPush.title,
          body: cfg.iosPush.body,
          threadId: `campaign:${cfg.id}`,
        });
        await recordSend(u.id, cfg.id, "ios_push", true);
        result.pushSent++;
      } catch (err: any) {
        console.error(`[campaign:${cfg.id}] push failed for ${u.id}:`, err);
        await recordSend(u.id, cfg.id, "ios_push", false, err?.message || "push_failed");
        result.pushFailed++;
      }
    }
  }

  // ── Premium grant — iOS users only.
  // Strategy: don't shorten existing Premium. If user already has Premium
  // expiring AFTER (now + durationDays), keep their existing expiry.
  if (cfg.channels.premiumGrant.enabled) {
    const grantUntil = new Date();
    grantUntil.setDate(grantUntil.getDate() + cfg.channels.premiumGrant.durationDays);
    const iosEligible = eligible.filter((u) => u.hasIosToken);
    for (const u of iosEligible) {
      if (await alreadySent(u.id, cfg.id, "premium_grant")) {
        result.premiumSkipped++;
        continue;
      }
      try {
        // Use the LATER of (existing expiry, new grant) so we never shorten.
        const existing = u.premiumUntil ? new Date(u.premiumUntil) : null;
        const newExpiry = existing && existing > grantUntil ? existing : grantUntil;
        await db
          .update(users)
          .set({ isPremium: true, premiumUntil: newExpiry.toISOString() })
          .where(eq(users.id, u.id));
        await recordSend(u.id, cfg.id, "premium_grant", true);
        result.premiumGranted++;
      } catch (err: any) {
        console.error(`[campaign:${cfg.id}] premium grant failed for ${u.id}:`, err);
        await recordSend(u.id, cfg.id, "premium_grant", false, err?.message || "grant_failed");
        result.premiumFailed++;
      }
    }
  }

  return {
    campaignId,
    dryRun: false,
    audience,
    results: result,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

// ─── Email templates ─────────────────────────────────────────────────────

const EMAIL_LOGO = `
<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
  <tr>
    <td style="vertical-align:middle;padding-right:10px;">
      <img src="https://spliiit.klarityit.ca/icon-192.png" width="36" height="36" alt="Spliiit" style="display:block;border-radius:8px;" />
    </td>
    <td style="vertical-align:middle;">
      <span style="font-size:18px;font-weight:700;color:#1a1a1a;letter-spacing:-0.3px;">Spl</span><span style="font-size:18px;font-weight:700;color:#2dd4a8;letter-spacing:-0.3px;">iii</span><span style="font-size:18px;font-weight:700;color:#1a1a1a;letter-spacing:-0.3px;">t</span>
    </td>
  </tr>
</table>
`;

function milestone1kEmailHtml(name: string): string {
  const firstName = (name || "there").split(" ")[0];
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.6;">
  ${EMAIL_LOGO}
  <h1 style="font-size:22px;font-weight:700;margin:0 0 16px;letter-spacing:-0.3px;">Hey ${escapeHtml(firstName)} — we just hit 1,000 users.</h1>
  <p style="font-size:15px;margin:0 0 16px;">Honestly that's wild for a side project that started because I couldn't split a roommate dinner fairly.</p>
  <p style="font-size:15px;margin:0 0 16px;">Quick thank-you: you've got <strong>Premium free for 30 days</strong> on the house, starting today. No card, no catch. Open Spliiit and AI Mode is already unlocked — PDF receipts, voice splits, the whole thing.</p>
  <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;padding:16px;margin:20px 0;">
    <p style="font-size:14px;margin:0 0 8px;font-weight:600;color:#0f766e;">What's AI Mode?</p>
    <p style="font-size:14px;margin:0;color:#134e4a;">Drop a receipt PDF (Uber Eats, Amazon, anything). Tell it how to split. Done. The only split app that reads PDFs.</p>
  </div>
  <p style="font-size:15px;margin:0 0 24px;">If Spliiit's made your life even slightly easier, the best way to thank me back is to tell one person about it.</p>
  <p style="font-size:15px;margin:0;color:#1a1a1a;">— Abhishek<br/><span style="font-size:13px;color:#6b7280;">Solo dev, Spliiit</span></p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;" />
  <p style="font-size:11px;color:#9ca3af;margin:0;">You're getting this because you signed up for Spliiit. This is a one-time milestone email — no marketing follow-ups.</p>
</div>
  `.trim();
}

function milestone1kEmailText(name: string): string {
  const firstName = (name || "there").split(" ")[0];
  return `Hey ${firstName} — we just hit 1,000 users.

Honestly that's wild for a side project that started because I couldn't split a roommate dinner fairly.

Quick thank-you: you've got Premium free for 30 days on the house, starting today. No card, no catch. Open Spliiit and AI Mode is already unlocked — PDF receipts, voice splits, the whole thing.

What's AI Mode? Drop a receipt PDF (Uber Eats, Amazon, anything). Tell it how to split. Done. The only split app that reads PDFs.

If Spliiit's made your life even slightly easier, the best way to thank me back is to tell one person about it.

— Abhishek
Solo dev, Spliiit

---
You're getting this because you signed up for Spliiit. This is a one-time milestone email — no marketing follow-ups.`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
