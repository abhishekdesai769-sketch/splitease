// server/emailUsage.ts
//
// Tracks how many emails we send per UTC day, so the admin can see how close
// we are to Resend's free-tier limit (100/day) without checking Resend's
// dashboard. Every successful send routes through email.ts → sendEmail(),
// which calls recordEmailSent() exactly once per recipient — so the count
// matches Resend's billing 1:1.

import { pool } from "./db";

// Resend free tier. Update this if you upgrade your Resend plan.
export const RESEND_DAILY_LIMIT = 100;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Increment today's email counter by one. Fire-and-forget — never throws,
 * never blocks the actual send. UPSERT so the first send of the day creates
 * the row.
 */
export async function recordEmailSent(): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO email_sends_daily (usage_date, count) VALUES ($1, 1)
       ON CONFLICT (usage_date) DO UPDATE SET count = email_sends_daily.count + 1`,
      [todayUtc()],
    );
  } catch (err) {
    // Telemetry must never break email delivery.
    console.error("[emailUsage] increment failed:", (err as Error)?.message);
  }
}

/** How many emails we've sent so far today (UTC). 0 if none / on error. */
export async function getEmailsSentToday(): Promise<number> {
  try {
    const r = await pool.query(
      `SELECT count FROM email_sends_daily WHERE usage_date = $1`,
      [todayUtc()],
    );
    return r.rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

/** Last 7 days of email volume, newest first. For an admin mini-trend. */
export async function getEmailUsageWindow(days = 7): Promise<Array<{ date: string; count: number }>> {
  try {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - days);
    const r = await pool.query(
      `SELECT usage_date, count FROM email_sends_daily
       WHERE usage_date >= $1 ORDER BY usage_date DESC`,
      [cutoff.toISOString().slice(0, 10)],
    );
    return r.rows.map((row: any) => ({ date: row.usage_date, count: row.count }));
  } catch {
    return [];
  }
}
