# Setup checklist — manual work pending

Living doc tracking the "post-deploy manual steps" that aren't in code yet.
Update as items get done. The status emoji is the source of truth.

**Last updated:** June 2026 (after Phase 5 security hardening)

---

## Status legend
- ✅ Done
- ⏳ In progress
- ⬜ Pending (do this next)
- ❌ Blocked (waiting on something)

---

## Production hardening — pending from security audit

These were ALL pushed to master and Render auto-deployed the code.
What's left is **dashboard configuration** that can't be code-automated.

### Render env vars (5 min — DO THIS FIRST)

Settings → Spliiit service → Environment. **Verify these exist:**

- ⬜ `SESSION_SECRET` — if missing, the next Render deploy will fail to start. If your app is currently working in production, this is set — but verify the value is ≥ 16 chars. Generate with `openssl rand -hex 32` if you need to create or rotate.
- ⬜ `STRIPE_WEBHOOK_SECRET` — if missing, Stripe webhooks return 503 (no Premium grants will work). Get from Stripe → Webhooks → your endpoint → Signing secret.
- ⬜ `DATABASE_URL` — check if the host contains `-pooler`. If NOT, the app is on the direct-connection URL (limited concurrent connections). To switch: Neon dashboard → Connection details → toggle "Connection pooling" → copy → paste into Render → restart.

### GitHub Actions secrets (DONE — daily backups working as of 2026-06-23)

GitHub → repo → Settings → Secrets and variables → Actions.

- ✅ `NEON_DATABASE_URL` — **no longer needed.** The `db-backup.yml` workflow was repointed to the existing `DATABASE_URL` secret (which was already set), so a separate Neon URL secret is not required.
- ✅ `BACKUP_GPG_PASSPHRASE` — added 2026-06-23, stored in 1Password. **CRITICAL:** if you lose this, ALL backups become unrecoverable.

Verified working: `db-backup.yml` succeeds and uploads an encrypted `backup-YYYY-MM-DD` release (197 KB `.gpg`, confirmed). It also opens a GitHub issue on failure (no more silent failures). The old redundant `nightly-backup.yml` was removed — there is now ONE encrypted daily backup.

### OneDrive backup (10 min — third copy beyond GitHub + laptop)

Sync these folders to your `abhishek.desai@klarityit.ca` OneDrive (exclude `node_modules` + `dist`):

- ⬜ `C:\Users\abhishek.desai\Downloads\Spliiit\repo\`
- ⬜ `C:\Users\abhishek.desai\.claude\projects\C--Users-abhishek-desai-Downloads-Spliiit\memory\`
- ⬜ Any local brand assets folder (app icons, screenshots, marketing materials)
- ⬜ iOS signing certs / .p12 / provisioning profiles if you have them locally

### 1Password vault setup (15 min — single source of truth for secrets)

Create a vault called **"Spliiit production"**. Add one secure-note entry per env var in `docs/env-vars.md`:

- ⬜ `DATABASE_URL`
- ⬜ `SESSION_SECRET`
- ⬜ `STRIPE_SECRET_KEY`
- ⬜ `STRIPE_PRICE_MONTHLY`
- ⬜ `STRIPE_PRICE_YEARLY`
- ⬜ `STRIPE_WEBHOOK_SECRET`
- ⬜ `RESEND_API_KEY`
- ⬜ `ANTHROPIC_API_KEY`
- ⬜ `APNS_KEY_RAW`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`
- ⬜ `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`
- ⬜ `ADMIN_EMAIL` (the override, not the fallback)
- ⬜ `NEON_DATABASE_URL` + `BACKUP_GPG_PASSPHRASE` (the GitHub Actions secrets)
- ⬜ Render service ID / API token (for programmatic deploys if needed)
- ⬜ GitHub Personal Access Token (for repo access in scripts)

This is what makes disaster recovery actually executable. Without it, recovery turns into a hunt across dashboards.

### Other open hardening items (lower priority, not blocking)

- ⬜ `npm audit fix` for 6 HIGH + 8 MODERATE prod-dep vulnerabilities (careful pass, no `--force`)
- ⬜ Add CSRF token middleware (`csurf` or similar)
- ⬜ Add `helmet` middleware for HSTS + CSP headers
- ⬜ Enable Gmail 2FA on `abhishekdesai769@gmail.com` (admin account)
- ⬜ Consider hardware security key for the admin Google account
- ⬜ Quarterly: dry-run restore from a backup (`docs/dr-runbook.md` Appendix A)

---

## Other pending product work

Tracked here so it doesn't get lost.

### iOS-only / next native build (from `next_ios_build_todo.md`)

- ⬜ Safe-area white-strip fix (capacitor.config.ts `contentInset:never` + viewport-fit=cover + env() safe-area padding)
- ⬜ Native in-app review via SKStoreReviewController (Capacitor in-app-review plugin)

### Campaigns

- ⬜ Verify all manual setup is done, then trigger 1k user thank-you campaign:
  1. Set `CAMPAIGN_1K_ENABLED=true` on Render → redeploy
  2. `/admin` → Campaigns panel → Dry-run preview → verify counts
  3. Send for real

### Splitwise import bug (pending fix)

- ⬜ Robust CSV parsing: strip BOM, loose Currency match, default to user's currency if missing, better error messages with header listing, UTF-16 detection.

### Client error logging (planned, not yet built)

- ⬜ `client_errors` table + migration
- ⬜ `/api/client-errors` POST endpoint
- ⬜ Wrap `apiRequest()` so failed API calls auto-log
- ⬜ `window.onerror` + `unhandledrejection` listeners that log
- ⬜ `/admin` "Recent Errors" panel

---

## Done — for reference

Code changes that have already shipped:

- ✅ Phase 1: pool tuning + ADMIN_EMAIL env-var override (commit `990aeb8`)
- ✅ Phase 2: hard-crash on missing SESSION_SECRET, refuse unsigned Stripe webhooks (commit `918b445`)
- ✅ Phase 3: per-email auth rate limit / IP-rotation defense (commit `c6c5f3e`)
- ✅ Phase 4: daily encrypted DB backup workflow (commit `12a00ed`)
- ✅ Phase 5: docs/env-vars.md + docs/dr-runbook.md + docs/security-posture.md (commit `01c6cd9`)

If you're continuing this work in a future Claude session, point Claude at:
- This file (`docs/setup-checklist.md`)
- `docs/env-vars.md`
- `docs/dr-runbook.md`
- `docs/security-posture.md`

Then say "check setup-checklist.md and continue from where I left off."

---

## How to use this file

Every time you do one of the ⬜ items: change it to ✅, add the date and any notes. When you discover new TODOs, add them. When something becomes blocked, mark it ❌ with the reason.

This file is the difference between "I think we did most of it" and "I know exactly what's left." Keep it current.
