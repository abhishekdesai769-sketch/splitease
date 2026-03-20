import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_cEO3zAWHbeU8@ep-twilight-mud-amqiubiy-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require',
});

async function migrate() {
  await client.connect();
  console.log('Connected to Neon PostgreSQL');

  try {
    await client.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS admin_ids TEXT[] DEFAULT '{}'`);
    console.log('Migration successful: admin_ids column added (or already exists)');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
