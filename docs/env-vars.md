# Environment variables — Spliiit production

Every env var the app reads at runtime, with what it does and where to get the value. **The actual values are NOT in this file.** Store them in 1Password (vault: "Spliiit production").

Set all of these in Render → Spliiit service → Environment → Add Environment Variable. The app will fail to start if the **REQUIRED** ones are missing (intentional — silent fallback is more dangerous than a loud failure).

---

## REQUIRED for the app to start

| Var | What it does | Where to get / regenerate |
|---|---|---|
| `DATABASE_URL` | Neon Postgres connection string. **Should be the pooled variant** (host contains `-pooler`). | Neon dashboard → Project → Connection details → toggle "Connection pooling" → copy. |
| `SESSION_SECRET` | Signs session cookies. ≥16 chars. Hard-crash on missing. | Generate: `openssl rand -hex 32`. Store in 1Password — rotating it logs everyone out. |
| `NODE_ENV` | `production` on Render | Render auto-sets this; verify. |

## REQUIRED for payments / Premium

| Var | What it does | Where to get |
|---|---|---|
| `STRIPE_SECRET_KEY` | Server-side Stripe API key. | Stripe dashboard → Developers → API keys → Secret key. Use a restricted key with the minimum scopes. |
| `STRIPE_PRICE_MONTHLY` | Stripe Price ID for the monthly plan. | Stripe → Products → Spliiit Premium → Monthly price → copy `price_…` ID. |
| `STRIPE_PRICE_YEARLY` | Stripe Price ID for the yearly plan. | Same flow, yearly price. |
| `STRIPE_WEBHOOK_SECRET` | Verifies inbound webhook signatures. **Refuses unsigned events in production.** | Stripe → Webhooks → your endpoint → Signing secret. Re-roll if the value leaks. |

## REQUIRED for email

| Var | What it does | Where to get |
|---|---|---|
| `RESEND_API_KEY` | Resend API key for transactional + campaign email. | Resend dashboard → API Keys → create. |

## REQUIRED for AI Mode (Premium feature)

| Var | What it does | Where to get |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API access for AI Mode + receipt transcription. | console.anthropic.com → API keys. |
| `AI_MODE_DAILY_WARNING_CENTS` | Per-day global spend $threshold for warning email. Default 1000 (=$10). | Set to a value that matches your risk tolerance. |
| `AI_MODE_DAILY_KILL_CENTS` | Per-day global spend threshold for auto-kill. Default 3000 (=$30). | Above warning. AI Mode auto-pauses if crossed. |
| `AI_MODE_DEGRADED` | Manual kill switch. Set to `true` to disable AI Mode immediately. | Leave unset normally. |

## REQUIRED for iOS push notifications

| Var | What it does | Where to get |
|---|---|---|
| `APNS_KEY_RAW` | Apple Push Notification key (.p8 file contents, BASE64). | Apple Developer → Keys → APNs key → download .p8 → `base64 -w0 < key.p8`. |
| `APNS_KEY_ID` | The Key ID (10 chars). | Same Apple page. |
| `APNS_TEAM_ID` | Apple Team ID. | Apple Developer → Membership. |
| `APNS_BUNDLE_ID` | `ca.klarityit.spliiit` | Hardcoded — should not change. |

## REQUIRED for Plaid (Money tab — early access)

| Var | What it does | Where to get |
|---|---|---|
| `PLAID_CLIENT_ID` | Plaid client ID. | Plaid dashboard → Team Settings → Keys. |
| `PLAID_SECRET` | Plaid secret (use the appropriate environment's secret). | Same page; pick `production` not `sandbox`. |
| `PLAID_ENV` | `production` | Or `sandbox` while testing. |

## OPTIONAL

| Var | Default | What it does |
|---|---|---|
| `ADMIN_EMAIL` | hardcoded fallback | Email of the super-admin user. Override on Render to a less-discoverable address. |
| `CAMPAIGN_1K_ENABLED` | unset | Set to `true` only when you're ready to fire the 1k milestone campaign. |
| `VITE_ENABLE_ONBOARDING_V2` | unset | Set to `true` to re-enable onboarding-v2 flow (currently OFF — hurt sign-up conversion). |

---

## GitHub Actions secrets (separate from Render env vars)

These are set in **GitHub → repo → Settings → Secrets and variables → Actions**, not on Render. Used only by CI workflows.

| Var | What it does |
|---|---|
| `NEON_DATABASE_URL` | Used by `.github/workflows/db-backup.yml` to pg_dump. Same value as Render's `DATABASE_URL`. |
| `BACKUP_GPG_PASSPHRASE` | Symmetric encryption passphrase for daily DB backups. **Store in 1Password — without this the backups are useless.** Generate with `openssl rand -hex 32`. |

---

## After rotating any secret

1. Update the value in 1Password
2. Update the value on Render (or GitHub Actions if it's a CI secret)
3. Restart the Render service (or trigger a redeploy)
4. Verify the app starts cleanly in logs

The `SESSION_SECRET` rotation has a UX consequence: every user gets logged out at restart. Pick a low-traffic window. Other secrets rotate transparently.
