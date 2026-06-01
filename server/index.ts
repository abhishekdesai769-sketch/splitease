import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startRecurringExpenseScheduler } from "./scheduler";
import { pool } from "./db";

const app = express();
const httpServer = createServer(app);

// ===== CORS — only allow requests from the official domain =====
app.use(
  cors({
    origin: process.env.CLIENT_URL || "https://spliiit.klarityit.ca",
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  })
);

// ===== Security headers via Helmet =====
app.use(
  helmet({
    contentSecurityPolicy: false, // handled by app's own CSP if needed
    crossOriginEmbedderPolicy: false, // allow embedding in TWA / Play Store
    crossOriginOpenerPolicy: false,
  })
);

// Disable X-Powered-By (redundant with helmet, but explicit)
app.disable("x-powered-by");

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "15mb", // large enough for base64-encoded receipt images
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

// Idempotent startup migrations — safely add new columns/tables without drizzle-kit push
async function runMigrations() {
  try {
    await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS notes text`);
    await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS currency text`);
    await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS original_amount real`);
    // Google OAuth support
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id text`);
    await pool.query(`ALTER TABLE users ALTER COLUMN password DROP NOT NULL`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_idx ON users(google_id) WHERE google_id IS NOT NULL`);
    // Apple Sign In support
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id text`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_apple_id_idx ON users(apple_id) WHERE apple_id IS NOT NULL`);
    // User preferences (currency + theme)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_currency text`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS currency_locked_at text`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference text NOT NULL DEFAULT 'system'`);
    // First-run wizard gate — null = user hasn't finished/skipped the wizard yet
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_run_completed_at text`);
    // Backfill: any existing user who already set their currency pre-dates the first-run wizard;
    // mark them as completed so they don't get force-routed through it on next login.
    // Idempotent because the WHERE clause only matches rows that haven't been backfilled yet.
    await pool.query(`UPDATE users SET first_run_completed_at = currency_locked_at WHERE first_run_completed_at IS NULL AND currency_locked_at IS NOT NULL`);
    // Weekly digest push throttle — null = never sent, otherwise ISO timestamp of last send
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_weekly_digest_push_at text`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id varchar,
        user_id varchar NOT NULL,
        user_name text NOT NULL,
        action text NOT NULL,
        description text NOT NULL,
        created_at text NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS activity_log_group_id_idx ON activity_log(group_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON activity_log(created_at)`);

    // ── Free AI scan quota (Phase 1+2 launch — May 2026) ──────────────────────
    // Idempotent additions so new environments boot cleanly without a separate
    // drizzle-kit push step. (We learned this lesson the hard way — bundling
    // schema-changing code with no migration runner = production outage.)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_ai_scans_used integer NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS free_ai_scans_granted integer NOT NULL DEFAULT 3`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS normalized_email text`);
    await pool.query(`CREATE INDEX IF NOT EXISTS users_normalized_email_idx ON users(normalized_email)`);

    // One-time backfill for normalized_email on existing users. Matches the
    // logic in server/premium-access.ts:normalizeEmail() — lowercase + strip
    // +alias + strip dots in the local-part for Gmail/Googlemail only.
    // Idempotent: WHERE normalized_email IS NULL gates it to first run only.
    await pool.query(`
      UPDATE users
      SET normalized_email = (
        CASE
          WHEN split_part(lower(email), '@', 2) IN ('gmail.com', 'googlemail.com')
          THEN replace(regexp_replace(split_part(lower(email), '@', 1), '\\+.*', ''), '.', '')
          ELSE regexp_replace(split_part(lower(email), '@', 1), '\\+.*', '')
        END
      ) || '@' || split_part(lower(email), '@', 2)
      WHERE normalized_email IS NULL
        AND email IS NOT NULL
        AND email LIKE '%@%'
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS device_scan_quota (
        device_id text PRIMARY KEY,
        scans_used integer NOT NULL DEFAULT 0,
        first_scan_at text NOT NULL,
        last_scan_at text NOT NULL,
        platform text
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_scan_audit (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        normalized_email text,
        device_id text,
        ip text,
        scanned_at text NOT NULL,
        success boolean NOT NULL,
        counted_against_free boolean NOT NULL DEFAULT false,
        parse_error text
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ai_scan_audit_user_id_idx ON ai_scan_audit(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ai_scan_audit_device_id_idx ON ai_scan_audit(device_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ai_scan_audit_normalized_email_idx ON ai_scan_audit(normalized_email)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ai_scan_audit_scanned_at_idx ON ai_scan_audit(scanned_at)`);

    // ── Plaid Money integration (May 2026 — Sandbox first, then Production)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS plaid_items (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        plaid_item_id text NOT NULL,
        access_token text NOT NULL,
        institution_id text,
        institution_name text,
        status text NOT NULL DEFAULT 'active',
        cursor text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS plaid_items_user_id_idx ON plaid_items(user_id)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS plaid_items_plaid_item_id_idx ON plaid_items(plaid_item_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS plaid_accounts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        item_id varchar NOT NULL,
        plaid_account_id text NOT NULL,
        name text NOT NULL,
        official_name text,
        mask text,
        type text NOT NULL,
        subtype text,
        current_balance real,
        available_balance real,
        iso_currency_code text,
        last_synced_at text NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS plaid_accounts_item_id_idx ON plaid_accounts(item_id)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS plaid_accounts_plaid_account_id_idx ON plaid_accounts(plaid_account_id)`);

    // ── AI Mode (May 2026) — conversational expense entry ────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_conversations (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        title text,
        status text NOT NULL DEFAULT 'active',
        created_at text NOT NULL,
        updated_at text NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ai_conversations_user_id_idx ON ai_conversations(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ai_conversations_updated_at_idx ON ai_conversations(updated_at)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_messages (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id varchar NOT NULL,
        role text NOT NULL,
        content text,
        tool_calls text,
        proposal text,
        attachments text,
        confirmed_at text,
        created_at text NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ai_messages_conversation_id_idx ON ai_messages(conversation_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ai_messages_created_at_idx ON ai_messages(created_at)`);

    // attachment_context: added June 2026. Stores the verbatim text
    // transcription of any receipts attached to a user message, so future
    // turns of the conversation can reference the receipt content even
    // after the file bytes have been discarded.
    await pool.query(`ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS attachment_context text`);

    // ── AI Mode usage tracking (June 2026 — abuse / quota) ────────────────
    // Per-user-per-day counters for quota enforcement + admin observability.
    // Written on every successful AI turn via aiQuota.incrementUsage().
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_usage_daily (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        usage_date text NOT NULL,
        text_turns integer NOT NULL DEFAULT 0,
        attachment_turns integer NOT NULL DEFAULT 0,
        image_attachments integer NOT NULL DEFAULT 0,
        pdf_attachments integer NOT NULL DEFAULT 0,
        estimated_cost_cents integer NOT NULL DEFAULT 0
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_daily_user_date_unique ON ai_usage_daily(user_id, usage_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ai_usage_daily_date_idx ON ai_usage_daily(usage_date)`);

    // Prevents flooding admin inbox with alert emails — one row per
    // (date, alert_kind). INSERT ON CONFLICT DO NOTHING is the lock.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_alerts_sent (
        alert_date text NOT NULL,
        alert_kind text NOT NULL,
        sent_at text NOT NULL,
        PRIMARY KEY (alert_date, alert_kind)
      )
    `);

    // ── Campaign sends (June 2026 — one-off thank-you / milestone blasts) ──
    // One row per (user, campaign, channel). UNIQUE constraint makes the
    // runner idempotent — re-running a campaign skips users already sent.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS campaign_sends (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL,
        campaign_id text NOT NULL,
        channel text NOT NULL,
        sent_at text NOT NULL,
        success boolean NOT NULL DEFAULT true,
        error_message text
      )
    `);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS campaign_sends_user_campaign_channel_unique ON campaign_sends(user_id, campaign_id, channel)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS campaign_sends_campaign_idx ON campaign_sends(campaign_id)`);

    log("Startup migrations OK", "db");
  } catch (e) {
    log(`Startup migration error: ${e}`, "db");
  }
}

(async () => {
  await runMigrations();
  await registerRoutes(httpServer, app);

  // Start recurring expense scheduler (premium feature — auto-creates expenses on schedule)
  startRecurringExpenseScheduler();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
