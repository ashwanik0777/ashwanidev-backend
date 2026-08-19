const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_gmyJkt3c4xDh@ep-steep-art-a10yu9l2-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&uselibpqcompat=true',
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT * FROM faculty_profiles");
  fs.writeFileSync('faculty_profiles_backup.json', JSON.stringify(res.rows, null, 2));
  console.log(`Backup completed! ${res.rows.length} rows exported to faculty_profiles_backup.json`);
  await client.end();
}
run().catch(console.error);
