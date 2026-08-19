/**
 * Faculty Image REVERT Script
 * Restores image_url from the backup taken BEFORE the update.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = 'postgresql://neondb_owner:npg_gmyJkt3c4xDh@ep-steep-art-a10yu9l2-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  // Use the FIRST backup (before any changes)
  const backupFile = path.join(__dirname, '..', 'faculty_backup_1787125284612.json');
  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  
  console.log(`Loaded ${backup.length} records from backup`);
  
  let reverted = 0;
  for (const row of backup) {
    await pool.query(
      `UPDATE faculty_profiles SET image_url = $1, updated_at = NOW() WHERE id = $2`,
      [row.image_url || '', row.id]
    );
    reverted++;
  }
  
  console.log(`✅ Reverted ${reverted} faculty image_url fields to original values.`);
  await pool.end();
}

main().catch(err => { console.error(err); pool.end(); process.exit(1); });
