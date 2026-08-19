const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_gmyJkt3c4xDh@ep-steep-art-a10yu9l2-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const jsonPath = '/Users/ashwanikushwaha/gbu-full-web/facultyImagePaths.json';
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // Backup current state
  const { rows: backupRows } = await pool.query('SELECT id, name, image_url FROM faculty_profiles ORDER BY id');
  const backupFile = `/Users/ashwanikushwaha/gbu-full-web/faculty_backup_soict_${Date.now()}.json`;
  fs.writeFileSync(backupFile, JSON.stringify(backupRows, null, 2));
  console.log('Backup saved to:', backupFile);

  const idEntries = data.filter(d => d.id && d.id.trim() !== '');
  console.log('Found ID entries in JSON:', idEntries.length);

  let updatedCount = 0;
  const updateDetails = [];

  for (const entry of idEntries) {
    const facId = entry.id.trim().toUpperCase();
    const imagePath = entry.path.trim();

    const res = await pool.query(
      'UPDATE faculty_profiles SET image_url = $1, updated_at = NOW() WHERE UPPER(id) = $2 RETURNING id, name, image_url',
      [imagePath, facId]
    );

    if (res.rowCount > 0) {
      updatedCount++;
      updateDetails.push({
        id: res.rows[0].id,
        name: res.rows[0].name,
        image_url: res.rows[0].image_url
      });
    } else {
      console.log('No DB record found for ID:', facId, entry.facultyName);
    }
  }

  console.log('\n========================================');
  console.log(`Successfully updated ${updatedCount} faculty profiles in DB.`);
  console.log('========================================');
  console.table(updateDetails);

  await pool.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
