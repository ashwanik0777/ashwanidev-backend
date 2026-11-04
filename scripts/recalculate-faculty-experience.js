/*
 * One-off: bring faculty_profiles.experience_years in line with each profile's
 * experience entries. Deploy the API first; the old code writes the old formula
 * back on the next profile save.
 *
 *   node scripts/recalculate-faculty-experience.js            dry run, rolled back
 *   node scripts/recalculate-faculty-experience.js --apply    writes the changes
 *
 * Connects to DATABASE_URL (shell first, then .env) and prints the host. Check
 * it before using --apply. Only experience_years changes; updated_at is left
 * alone because the faculty member edited nothing.
 */
const env = require("../src/config/env");
const { getDbPool, closeDb } = require("../src/config/db");
const { calculateExperienceYears } = require("../src/utils/facultyExperience");

const apply = process.argv.includes("--apply");

const main = async () => {
	console.log(`Database: ${new URL(env.databaseUrl).hostname}`);
	console.log(apply ? "Mode: APPLY" : "Mode: dry run (rolled back)");

	const client = await getDbPool().connect();
	try {
		await client.query("BEGIN");

		const { rows } = await client.query(
			`SELECT id, name, experience_years, tab_data->'qualifications'->'experience' AS entries
			 FROM faculty_profiles ORDER BY id`
		);

		const changes = rows
			.map((row) => ({
				id: row.id,
				name: row.name,
				from: row.experience_years,
				to: calculateExperienceYears(row.entries),
			}))
			.filter((change) => change.from !== change.to);

		const result = await client.query(
			`UPDATE faculty_profiles f SET experience_years = c.years
			 FROM unnest($1::text[], $2::int[]) AS c(id, years)
			 WHERE f.id = c.id`,
			[changes.map((change) => change.id), changes.map((change) => change.to)]
		);

		console.table(changes);
		console.log(`${rows.length} profiles checked, ${result.rowCount} to change.`);

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
