import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

// Connection pool sizing:
//
// We run two pools (this one + a session-store pool in routes.ts), so the
// effective per-instance count is 2 × max. With Neon's connection limits
// (~10–20 direct, thousands via pooler), capping each pool at 5 keeps us
// well under the direct cap and is plenty for Spliiit's traffic levels.
//
// idleTimeoutMillis keeps connections from hanging open indefinitely;
// connectionTimeoutMillis prevents requests from queuing forever during
// transient Neon throttling — fast fail beats slow degrade.
//
// REMINDER: the URL should be Neon's "Pooled connection" string (host
// contains "-pooler") for maximum headroom. See docs/dr-runbook.md.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Neon (serverless Postgres) aggressively closes IDLE connections. When it
// does, node-postgres emits an 'error' event on the idle client — and in Node,
// an EventEmitter that emits 'error' with NO listener THROWS, crashing the
// whole process (Render logs this as "Exited with status 1"). This listener
// makes a reaped idle connection a logged non-event instead of fatal; the pool
// self-heals by opening a fresh connection on the next query. The pg docs
// explicitly require this handler.
pool.on("error", (err) => {
  console.error("[db] idle Postgres client error (non-fatal):", (err as Error)?.message);
});

export const db = drizzle(pool, { schema });
