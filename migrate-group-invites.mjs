import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: "postgresql://neondb_owner:npg_cEO3zAWHbeU8@ep-twilight-mud-amqiubiy-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require" });
await pool.query(`CREATE TABLE IF NOT EXISTS group_invites (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id VARCHAR NOT NULL,
  inviter_id VARCHAR NOT NULL,
  invitee_id VARCHAR NOT NULL,
  admin_approved BOOLEAN NOT NULL DEFAULT false,
  admin_approved_by VARCHAR,
  invitee_accepted BOOLEAN,
  status VARCHAR NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
)`);
console.log("Migration done");
await pool.end();
