# CLAUDE.md – Spliiit

## Project overview
Spliiit is a full-stack expense-splitting PWA (Progressive Web App) published on Google Play.

## Tech stack
- **Frontend:** React 18 + TypeScript, Vite, TailwindCSS, Radix UI
- **Backend:** Express.js (Node.js, ES modules)
- **Database:** Neon PostgreSQL (serverless) + Drizzle ORM
- **Hosting:** Render (auto-deploys from master branch)
- **Email:** Resend (transactional emails)
- **App Store:** Google Play (TWA via PWABuilder) + iOS App Store (Capacitor + Fastlane)

## Key directories
- `client/src/pages/` — page components (auth, dashboard, groups, expenses, admin)
- `client/src/components/` — UI components + Radix primitives
- `server/routes.ts` — all API endpoints
- `server/db.ts` — Drizzle ORM / database setup
- `shared/schema.ts` — Zod validation schemas

## Workflow instructions
When I give a vague or one-line request, ask me 2–3 clarifying questions before starting, then follow this workflow:
1. **Explore** — find the relevant files, data model, and existing patterns
2. **Plan** — propose the approach and wait for my approval
3. **Implement** — make the changes in small, reviewable steps
4. **Verify** — confirm the change works and nothing is broken
