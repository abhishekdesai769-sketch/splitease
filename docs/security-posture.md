# Security posture — Spliiit

Snapshot of what's protecting the app today, what's known weak, and what's planned. Update this when the surface changes.

Last reviewed: June 2026.

---

## What's protected

### Authentication
- Passwords: scrypt with salt (`server/middleware.ts`), constant-time comparison
- Legacy SHA-256 hashes auto-upgrade to scrypt on next successful login
- Session cookies: `httpOnly` + `secure` (prod) + `sameSite=lax` + 90-day rolling expiry
- Sessions persisted in Postgres (`connect-pg-simple`), survive deploys
- `SESSION_SECRET` hard-required in production (server refuses to start if missing)
- Per-IP rate limit on `/api/auth/login` + `/api/auth/send-otp` (20/15min)
- Per-EMAIL rate limit on same endpoints (10 failed logins/hr, 5 OTPs/hr) — defeats IP-rotation attacks
- OTP codes: 6 digits, 10-minute expiry, one-time use
- Email verification required to sign up (OTP)
- Google OAuth supported as alternative; password-less for those accounts
- Apple Sign In supported on iOS native

### Authorization
- `requireAuth` middleware on every authenticated endpoint
- `requireAdmin` middleware on admin endpoints (gated by `isAdmin` flag)
- Per-resource ownership checks (e.g. `group.createdById === userId`) on mutating endpoints
- AI Mode: payer-locked to current user (3-layer enforcement: tool description, system prompt, server validation)
- Stripe webhook signature verification (production refuses unsigned events)

### Data
- All user input runs through Zod schemas for validation
- Drizzle ORM uses parameterized queries — no raw user input in SQL
- File uploads (multer): 10MB/file limit, 5 files max per request, MIME-type allowlist
- Receipt PDF/image bytes: parse-and-discard, never persisted (only metadata + extracted text)
- Anthropic API: no training on submitted data (per their API terms)

### Infrastructure
- Render: TLS termination, auto-HTTPS
- Neon Postgres: encrypted at rest, encrypted in transit (TLS), pooled connection URL
- Daily off-Neon DB backup: encrypted GPG → GitHub Releases
- Connection pool capped at 5 per pool × 2 pools = 10 max per Render instance

### Code/Repo
- `.gitignore` excludes `.env*`, `*.sql`, `*.sql.gz`, signing artifacts
- No secrets in repo history (verified via `git log -p` scan)
- `ADMIN_EMAIL` reads from env var (defense against public-repo phishing)

### Abuse prevention (AI Mode specifically)
- Premium-only feature; non-Premium iOS gets 3-turn trial
- Per-user daily quota: 50 turns / 10 image uploads / 20 total attachments
- Per-user per-minute rate limit (10 msg/min, 3 attach/min)
- Per-conversation max turns: 50
- Global daily-spend warning + kill switch (env-var thresholds)
- Spend tracking + admin observability panel

---

## Known weaknesses

| Weakness | Severity | Workaround / plan |
|---|---|---|
| In-memory rate limit (`rateLimit()` in middleware.ts) | Medium | Per-IP, resets on restart, not shared across instances. Mitigated by per-email throttle for auth. Other endpoints still have the per-IP limit only. **Plan:** swap for a Redis-backed limiter if/when traffic justifies. |
| No CSRF token (relies on `sameSite=lax` cookie only) | Low/Medium | Lax sameSite covers most CSRF in modern browsers. Browser quirks on top-level POSTs are a theoretical hole. **Plan:** add `csurf` if a real exploit emerges. |
| npm audit: prod deps have HIGH-severity vulnerabilities | Unclear | Some are theoretical for our usage. **Plan:** quarterly audit pass via `npm audit fix` (no `--force`) + manual review. |
| No 2FA on user accounts | Low | OTP at signup gives some assurance. **Plan:** TOTP 2FA opt-in once user count justifies the support cost. |
| No HSTS / CSP headers | Low | Render serves over TLS regardless; HSTS reinforces. **Plan:** add `helmet` middleware. |
| No CAPTCHA on auth endpoints | Low | Per-email throttle is the main defense. **Plan:** Cloudflare Turnstile if abuse appears. |
| No 2FA / hardware key on admin email | Medium | **Plan:** enable 2FA on Gmail, store backup codes in 1Password, consider hardware key. |

---

## Threat model

We're a finance app, but a soft one — we don't move money, we track balances. The most credible threats:

1. **Account takeover** → attacker logs in as a user, sees/modifies their data. Defenses: rate limits, OTP verification on signup, scrypt passwords.
2. **Premium-bypass** → user gets Premium without paying. Defenses: Stripe webhook signature verification, IAP receipt validation, per-seat lock on AI Mode.
3. **Data loss** → Neon outage or accidental delete. Defenses: Neon's 7-day PITR + daily off-Neon backup to GitHub.
4. **Compromise of admin email** → attacker takes over Gmail, signs up to Spliiit with that email, becomes admin. Defenses: env-var override for ADMIN_EMAIL, Gmail 2FA.
5. **AI API token theft** → attacker abuses Anthropic key. Defenses: per-user quota, global kill switch, hourly spend alerts.

We are NOT a serious target for nation-state attackers, ransomware operators, or organized crime. The app's appeal is to opportunists (credential stuffers, scrapers, fraudsters). Defense-in-depth against opportunists is exactly what we have.

---

## Incident response

1. **Suspect a breach:** kill the running app (set `AI_MODE_DEGRADED=true` + revoke Render service)
2. **Investigate:** check `auth_attempts` for anomalies, check `campaign_sends` for suspicious sends, check admin logs
3. **Restore if needed:** follow `dr-runbook.md`
4. **Rotate every secret:** generate fresh SESSION_SECRET, Stripe keys, Resend key, Anthropic key, APNs key
5. **Force logout all users:** SESSION_SECRET rotation does this automatically
6. **Email users transparently:** finance-app reputation lives or dies on this
7. **Post-mortem:** what went wrong, what was the gap, what's the fix

---

## Quarterly checklist

Every 3 months:

- [ ] `npm audit` — review HIGH+, fix what's exploitable
- [ ] Dry-run backup restore (Appendix A of dr-runbook.md)
- [ ] Rotate `SESSION_SECRET` (optional — logs everyone out)
- [ ] Review admin user list — anyone shouldn't be there?
- [ ] Review `auth_attempts` table — patterns of abuse?
- [ ] Update this document if new mitigations or new gaps
