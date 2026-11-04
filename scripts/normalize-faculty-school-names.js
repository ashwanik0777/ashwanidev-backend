/*
 * One-off, safe to re-run: put the full school name in faculty_profiles.school
 * wherever it holds the short code ("SOICT" becomes "School of Information &
 * Communication Technology"). school_code is what filters and permissions use
 * and is never changed.
 *
 *   node scripts/normalize-faculty-school-names.js            dry run, rolled back
 *   node scripts/normalize-faculty-school-names.js --apply    writes the changes
 *
 * Connects to DATABASE_URL (shell first, then .env) and prints the host. Check
 * it before using --apply. A value that is neither the code nor the name of the
 * row's school is left alone and listed. updated_at is not touched, because the
 * faculty member edited nothing.
 */
const env = require("../src/config/env");
const { getDbPool, closeDb } = require("../src/config/db");

const apply = process.argv.includes("--apply");

const SUMMARY = `
	SELECT f.school_code, COALESCE(s.name, '(no matching school)') AS full_name,
		count(*) FILTER (WHERE f.school = s.name)::int AS full_form,
		count(*) FILTER (WHERE f.school IS DISTINCT FROM s.name)::int AS other
	FROM faculty_profiles f
	LEFT JOIN schools s ON LOWER(s.code) = LOWER(f.school_code)
	GROUP BY 1, 2 ORDER BY 1`;

const main = async () => {
	console.log(`Database: ${new URL(env.databaseUrl).hostname}`);
	console.log(apply ? "Mode: APPLY" : "Mode: dry run (rolled back)");

	const client = await getDbPool().connect();
	try {
		await client.query("BEGIN");

		console.log("\nBefore:");
		console.table((await client.query(SUMMARY)).rows);

		const updated = await client.query(
			`UPDATE faculty_profiles f SET school = s.name
			 FROM schools s
			 WHERE LOWER(s.code) = LOWER(f.school_code)
				AND f.school <> s.name
				AND (LOWER(TRIM(f.school)) IN (LOWER(s.code), LOWER(s.name)) OR TRIM(f.school) = '')`
		);

		console.log("After:");
		console.table((await client.query(SUMMARY)).rows);

		const leftover = await client.query(
			`SELECT f.id, f.name, f.school, f.school_code
			 FROM faculty_profiles f
			 LEFT JOIN schools s ON LOWER(s.code) = LOWER(f.school_code)
			 WHERE f.school IS DISTINCT FROM s.name
			 ORDER BY f.id`
		);
		if (leftover.rows.length) {
			console.log("Not changed, needs a person to look at:");
			console.table(leftover.rows);
		}

		console.log(`${updated.rowCount} profiles to change, ${leftover.rows.length} left alone.`);

		await client.query(apply ? "COMMIT" : "ROLLBACK");
		console.log(apply ? "Committed." : "Rolled back; nothing was changed.");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
		await closeDb();
	}
};

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
