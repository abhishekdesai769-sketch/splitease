# Disaster Recovery Runbook — Spliiit

**Goal:** rebuild Spliiit production end-to-end in under 1 hour, with all data intact.

This file is a checklist for the worst-case scenarios: Neon outage, Render outage, hacked account, accidental deletion. Each scenario has a separate path. Skim before incident, follow during.

If you're reading this during an incident: stay calm, work in order, don't skip the verification steps at the end.

---

## Prerequisites (do these BEFORE an incident)

- [ ] `docs/env-vars.md` is current — every required env var documented
- [ ] All env var **values** are in 1Password (vault: "Spliiit production")
- [ ] `.github/workflows/db-backup.yml` is running daily (check Actions tab)
- [ ] You have admin access to: Render, Neon, GitHub, Cloudflare, Stripe, Resend, Apple Developer, Google Play Console, Anthropic console
- [ ] Latest GitHub release named `backup-YYYY-MM-DD` exists and is recent (today or yesterday)
- [ ] You've successfully done a dry-run restore at least once (see Appendix A)

If any of these are unchecked, fix them today. Not during the incident.

---

## Scenario 1 — Render is down or app is broken, DB is fine

**Time to recovery: ~15 min**

This is the easy case. Your data is safe in Neon; only the running app is broken.

1. Confirm: visit https://status.render.com — is Render the issue, or is it you?
2. If Render is down: post a status page note on your domain (Cloudflare → Workers can serve a simple "we're back soon" page). Wait it out — Render usually recovers in <1 hour.
3. If your deploy is broken: revert via Render dashboard → Deployments → click previous successful deploy → Redeploy.
4. If your code is broken on master: `git revert <commit>` locally, push to master, Render auto-deploys.
5. Verify: app loads, login works, balances display correctly.

---

## Scenario 2 — Neon database is unavailable / locked / accidentally deleted

**Time to recovery: 30–60 min**

This is the case the daily backup workflow is for.

### Step 1: provision a new Neon project (5 min)

1. Go to https://console.neon.tech → New project
2. Name: `spliiit-recovery-YYYY-MM-DD`
3. Region: `aws-us-east-2` (or your previous region — check old project)
4. Postgres version: 16 (matches what we use)
5. Once created, go to Connection details → toggle **Connection pooling** → copy the pooled URL

### Step 2: restore the latest backup (10–15 min)

On your local machine:

```bash
# 1. List recent backups
gh release list --repo abhishekdesai769-sketch/splitease | grep backup-

# 2. Download the most recent one
gh release download backup-2026-06-15 --pattern '*.gpg' --repo abhishekdesai769-sketch/splitease

# 3. Decrypt (passphrase from 1Password → "BACKUP_GPG_PASSPHRASE")
gpg --decrypt spliiit-backup-2026-06-15T*.sql.gz.gpg > backup.sql.gz

# 4. Unzip
gunzip backup.sql.gz

# 5. Restore into the new Neon DB. Use the NON-pooled URL for this; pgbouncer
#    doesn't support all the metadata operations pg_dump produces.
psql "<NEW_NEON_DIRECT_URL>" < backup.sql

# Expected output: lots of CREATE TABLE / ALTER TABLE / COPY lines. No errors.
```

Common gotchas:

- If you see "permission denied" errors, the new database role might not have CREATE permission. Connect as the Neon admin role.
- If you see "relation already exists" errors, the `--clean` flag in pg_dump should have prevented this. Means the database isn't empty — drop and recreate.
- If `gpg` complains about the passphrase: try copy-pasting from 1Password without trailing whitespace.

### Step 3: update Render env vars (5 min)

1. Render dashboard → Spliiit service → Environment
2. Update `DATABASE_URL` to the new Neon pooled URL
3. Save (Render auto-redeploys)

### Step 4: verify (5 min)

1. Visit your app, log in
2. Check a known group's expenses — they should be there
3. Check the AI Usage panel in /admin — past usage should be there
4. Create a test expense, verify it persists across page refresh

If the restore looks wrong, you can try an older backup (`gh release list` → pick older).

---

## Scenario 3 — Render account is locked or compromised

**Time to recovery: 30–45 min**

1. Reset / recover your Render account first (Render support)
2. While waiting: provision a new Render service from your GitHub repo
   - Render → New → Web Service → connect GitHub → pick `splitease` repo, `master` branch
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Region: same as before (Oregon if you used us-west)
3. Set all env vars from `docs/env-vars.md` (values from 1Password)
4. Once it builds and starts, update DNS:
   - Cloudflare → klarityit.ca → DNS → CNAME record for `spliiit` → point at new Render service URL
   - DNS propagation: usually <5 min
5. Verify: https://spliiit.klarityit.ca loads correctly

The old Render service can be deleted once verified.

---

## Scenario 4 — GitHub repo is gone (deleted, account hacked)

**Time to recovery: 15 min**

If GitHub is the issue, the code is the casualty — but your local laptop and any OneDrive backup still have the repo with full git history.

1. Recover GitHub account (GitHub support)
2. Or: push your local repo to a new remote (Codeberg, GitLab, self-hosted)
3. Reconnect Render to the new remote, redeploy
4. Update DR runbook to reference the new repo for backup workflow

This scenario is why your project folder must also live in OneDrive (per the security plan). Belt + suspenders.

---

## Scenario 5 — Total wipeout (everything compromised at once)

**Time to recovery: 60 min if prerequisites are intact**

Worst case. Everything down at once. Follow these steps in order:

1. **Get a working code copy** — from your local laptop, or OneDrive
2. **Push to a fresh git remote** — new GitHub account, GitLab, etc. (5 min)
3. **New Neon project + restore** — Scenario 2, Steps 1-2 (15-20 min)
4. **New Render service from new git remote** — Scenario 3, Step 2 (15 min)
5. **Add env vars from 1Password** — Scenario 3, Step 3 (10 min)
6. **DNS update on Cloudflare** — point to new Render service (5 min)
7. **Verify end-to-end** — login, expenses load, AI Mode works, push notifications still arrive (5 min)
8. **Send communication email to users** — use the campaigns infra:
   - Set up `CAMPAIGN_1K_ENABLED=true` temporarily, edit subject/body to incident copy
   - Or send manually via Resend dashboard
   - Tell users what happened in plain language; finance app credibility depends on transparency

If the GPG passphrase is lost (and you didn't store it in 1Password): the backups are unrecoverable. Your only fallback is Neon's auto-retention (7-day Point-in-Time-Restore on free tier) — talk to Neon support.

---

## Appendix A — Dry-run restore (do this every quarter)

You should test that backups actually work. Don't wait for an incident.

```bash
# 1. Spin up a free Neon project just for testing
# 2. Download a recent backup
gh release download backup-2026-06-15 --pattern '*.gpg' --repo abhishekdesai769-sketch/splitease
gpg --decrypt spliiit-backup-*.sql.gz.gpg > backup.sql.gz
gunzip backup.sql.gz

# 3. Restore into the test Neon
psql "<TEST_NEON_DIRECT_URL>" < backup.sql

# 4. Connect and verify schema looks right
psql "<TEST_NEON_DIRECT_URL>" -c "\dt"
# You should see all your tables: users, groups, expenses, ai_messages, etc.

# 5. Spot-check a few rows
psql "<TEST_NEON_DIRECT_URL>" -c "SELECT COUNT(*) FROM users;"
psql "<TEST_NEON_DIRECT_URL>" -c "SELECT COUNT(*) FROM expenses;"

# 6. Delete the test Neon project — it served its purpose
```

If anything fails, fix the workflow before it matters.

---

## Appendix B — What's NOT in this runbook

Things you might lose that can be re-issued (so they don't block recovery, but plan separately):

- **Apple Developer signing certificates** — re-issue via Apple Developer Account
- **Google Play signing key** — Google Play uses Play App Signing; the key is held by Google
- **Stripe customer relationships** — Stripe holds the source of truth; resubscriptions just need the same Stripe products
- **APNs key** — re-issue from Apple Developer (revokes the old one)
- **Resend account / sending domain** — re-verify DNS records on Cloudflare

The data on these third parties is THEIR problem to keep; they all have their own DR.

---

## Phone numbers and links you'll want during an incident

- Render status: https://status.render.com
- Neon status: https://neonstatus.com
- GitHub status: https://www.githubstatus.com
- Cloudflare status: https://www.cloudflarestatus.com
- Resend status: https://resend-status.com

Bookmark these on whatever device you'll have access to during a panic.
