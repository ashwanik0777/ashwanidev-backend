const { Pool } = require('pg');
require('dotenv').config({ path: '/Users/ashwanikushwaha/gbu-full-web/gbu-website-backend/.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function run() {
  try {
    const res = await pool.query(
      `UPDATE faculty_profiles SET image_url = $1 WHERE id = $2 RETURNING name`, 
      ['/assets/Faculty/SOL-F0017.jpg', 'SOL-F0017']
    );
    if (res.rowCount > 0) {
      console.log(`Updated SOL-F0017 (${res.rows[0].name})`);
    } else {
      console.log(`Failed to find SOL-F0017`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

run();
