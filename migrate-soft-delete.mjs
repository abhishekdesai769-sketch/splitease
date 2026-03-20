import pg from "pg";

const { Client } = pg;

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_cEO3zAWHbeU8@ep-twilight-mud-amqiubiy-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require",
});

async function migrate() {
  await client.connect();
  console.log("Connected to Neon DB");

  await client.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS deleted_at TEXT DEFAULT NULL;`);
  console.log("Added deleted_at to groups");

  await client.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TEXT DEFAULT NULL;`);
  console.log("Added deleted_at to expenses");

  await client.end();
  console.log("Migration complete");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
