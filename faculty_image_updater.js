/**
 * Faculty Image Updater Script
 * 
 * STEP 1: Backup all faculty_profiles data (id, name, image_url)
 * STEP 2: Match faculty names from JSON to DB using fuzzy matching
 * STEP 3: Only UPDATE image_url WHERE it's currently empty
 * STEP 4: Generate a detailed report of all matches and actions
 * 
 * Safety measures:
 * - Backup is created FIRST before any changes
 * - Only updates image_url column, nothing else
 * - Only updates rows where image_url is currently empty
 * - Dry-run mode by default (set DRY_RUN=false to actually update)
 * - Full report of matches, mismatches, and skips
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--execute') ? false : true;

const DATABASE_URL = 'postgresql://neondb_owner:npg_gmyJkt3c4xDh@ep-steep-art-a10yu9l2-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Load the faculty image paths JSON
const imagePaths = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'facultyImagePaths.json'), 'utf8'));

// Clean a name for comparison - strip titles, lowercase, normalize whitespace
function cleanName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/dr\.|dr|prof\.|prof|mr\.|mr|ms\.|ms|mrs\.|mrs|shri|smt\.|smt/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

// Generate multiple matching keys for a name
function generateMatchKeys(name) {
  const cleaned = cleanName(name);
  if (!cleaned) return [];
  
  const keys = [cleaned];
  
  // Also try without spaces (for names like "Amitkawasthi" matching "Amit Kawasthi")
  keys.push(cleaned.replace(/\s+/g, ''));
  
  // Parts of the name
  const parts = cleaned.split(' ');
  if (parts.length > 1) {
    // Try last name + first name
    keys.push(parts.slice().reverse().join(' '));
    // Try just last name
    if (parts[parts.length - 1].length > 3) {
      keys.push(parts[parts.length - 1]);
    }
  }
  
  return [...new Set(keys)];
}

async function main() {
  console.log('='.repeat(70));
  console.log(DRY_RUN ? '  🔍 DRY RUN MODE (no changes will be made)' : '  ⚡ EXECUTE MODE (changes WILL be applied)');
  console.log('='.repeat(70));
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: BACKUP
  // ═══════════════════════════════════════════════════════════════
  console.log('📦 Step 1: Creating backup of all faculty_profiles...');
  
  const { rows: allFaculty } = await pool.query(
    `SELECT id, name, designation, department, school, email, image_url 
     FROM faculty_profiles ORDER BY name ASC`
  );
  
  console.log(`   Found ${allFaculty.length} faculty records in database.`);
  
  const backupPath = path.join(__dirname, '..', `faculty_backup_${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(allFaculty, null, 2));
  console.log(`   ✅ Backup saved to: ${backupPath}`);
  console.log('');
  
  // ═══════════════════════════════════════════════════════════════
  // STEP 2: BUILD IMAGE MAP
  // ═══════════════════════════════════════════════════════════════
  console.log('🗂️  Step 2: Building image lookup map...');
  
  // Build a map from cleaned name -> image path
  const imageMap = {};
  const imageMapNoSpaces = {};
  
  for (const entry of imagePaths) {
    const cleaned = cleanName(entry.name);
    if (cleaned) {
      imageMap[cleaned] = entry.path;
      imageMapNoSpaces[cleaned.replace(/\s+/g, '')] = entry.path;
    }
  }
  
  console.log(`   Built map with ${Object.keys(imageMap).length} entries.`);
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: MATCH AND UPDATE
  // ═══════════════════════════════════════════════════════════════
  console.log('🔗 Step 3: Matching faculty to images...');
  console.log('');

  const results = {
    matched_and_updated: [],
    matched_but_already_has_image: [],
    no_match: [],
    errors: [],
  };

  for (const faculty of allFaculty) {
    const dbName = faculty.name;
    const dbId = faculty.id;
    const currentImageUrl = (faculty.image_url || '').trim();
    
    // Try to find a matching image
    const matchKeys = generateMatchKeys(dbName);
    let matchedPath = null;
    let matchedKey = null;
    
    for (const key of matchKeys) {
      // Exact match in imageMap
      if (imageMap[key]) {
        matchedPath = imageMap[key];
        matchedKey = key;
        break;
      }
      // No-spaces match
      if (imageMapNoSpaces[key]) {
        matchedPath = imageMapNoSpaces[key];
        matchedKey = key + ' (no-spaces)';
        break;
      }
    }
    
    // Also try substring matching as last resort
    if (!matchedPath) {
      const cleaned = cleanName(dbName);
      for (const [mapKey, mapPath] of Object.entries(imageMap)) {
        // Only match if one contains the other AND the shorter name is at least 5 chars
        if (mapKey.length >= 5 && cleaned.length >= 5) {
          if (cleaned.includes(mapKey) || mapKey.includes(cleaned)) {
            matchedPath = mapPath;
            matchedKey = mapKey + ' (substring)';
            break;
          }
        }
      }
    }
    
    if (!matchedPath) {
      results.no_match.push({ id: dbId, name: dbName });
      continue;
    }
    
    // Check if already has an image
    if (currentImageUrl && currentImageUrl !== '') {
      results.matched_but_already_has_image.push({
        id: dbId,
        name: dbName,
        existingImage: currentImageUrl,
        newImage: matchedPath,
        matchedVia: matchedKey,
      });
      continue;
    }
    
    // Update!
    if (!DRY_RUN) {
      try {
        await pool.query(
          `UPDATE faculty_profiles SET image_url = $1, updated_at = NOW() WHERE id = $2`,
          [matchedPath, dbId]
        );
      } catch (err) {
        results.errors.push({ id: dbId, name: dbName, error: err.message });
        continue;
      }
    }
    
    results.matched_and_updated.push({
      id: dbId,
      name: dbName,
      imagePath: matchedPath,
      matchedVia: matchedKey,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: REPORT
  // ═══════════════════════════════════════════════════════════════
  console.log('');
  console.log('═'.repeat(70));
  console.log('  📊 REPORT');
  console.log('═'.repeat(70));
  console.log('');
  console.log(`  Total faculty in DB:                  ${allFaculty.length}`);
  console.log(`  Total images available in JSON:       ${imagePaths.length}`);
  console.log(`  ✅ Matched & ${DRY_RUN ? 'WOULD BE updated' : 'UPDATED'}:          ${results.matched_and_updated.length}`);
  console.log(`  ⏭️  Matched but already has image:     ${results.matched_but_already_has_image.length}`);
  console.log(`  ❌ No match found:                    ${results.no_match.length}`);
  console.log(`  ⚠️  Errors:                            ${results.errors.length}`);
  console.log('');
  
  if (results.matched_and_updated.length > 0) {
    console.log(`── ${DRY_RUN ? 'WOULD BE UPDATED' : 'UPDATED'} (${results.matched_and_updated.length}) ──`);
    for (const r of results.matched_and_updated) {
      console.log(`  [${r.id}] "${r.name}" → ${r.imagePath}  (matched via: ${r.matchedVia})`);
    }
    console.log('');
  }
  
  if (results.matched_but_already_has_image.length > 0) {
    console.log(`── SKIPPED (already has image) (${results.matched_but_already_has_image.length}) ──`);
    for (const r of results.matched_but_already_has_image) {
      console.log(`  [${r.id}] "${r.name}"`);
      console.log(`     existing: ${r.existingImage}`);
      console.log(`     new img:  ${r.newImage}  (match: ${r.matchedVia})`);
    }
    console.log('');
  }
  
  if (results.no_match.length > 0) {
    console.log(`── NO MATCH (${results.no_match.length}) ──`);
    for (const r of results.no_match) {
      console.log(`  [${r.id}] "${r.name}"`);
    }
    console.log('');
  }

  if (results.errors.length > 0) {
    console.log(`── ERRORS (${results.errors.length}) ──`);
    for (const r of results.errors) {
      console.log(`  [${r.id}] "${r.name}" - ${r.error}`);
    }
    console.log('');
  }

  // Save full report
  const reportPath = path.join(__dirname, '..', `faculty_image_report_${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`📝 Full report saved to: ${reportPath}`);
  
  if (DRY_RUN) {
    console.log('');
    console.log('⚠️  This was a DRY RUN. No changes were made to the database.');
    console.log('   Run with --execute flag to apply changes:');
    console.log('   node faculty_image_updater.js --execute');
  }

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
