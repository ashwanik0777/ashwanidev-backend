/*
 * One-off, safe to re-run: put every faculty name in title case
 * ("ANKIT BAKSHI" and "dr. eti sharma" become "Ankit Bakshi" and
 * "Dr. Eti Sharma"). The rules are in src/utils/personName.js.
 *
 * Covers faculty_profiles.name, users.name for faculty logins, and
 * faculty_registration_requests.name.
 *
 *   node scripts/normalize-faculty-name-case.js            dry run, rolled back
 *   node scripts/normalize-faculty-name-case.js --apply    writes the changes
 *
 * Connects to DATABASE_URL (shell first, then .env) and prints the host. Check
 * it before using --apply. Every change is listed. updated_at is not touched,
 * because the faculty member edited nothing.
 */
const env = require("../src/config/env");
const { getDbPool, closeDb } = require("../src/config/db");
const { toTitleCaseName } = require("../src/utils/personName");

const apply = process.argv.includes("--apply");

const TARGETS = [
	{ table: "faculty_profiles", where: "TRUE" },
	{ table: "users", where: "role = 'faculty'" },
	{ table: "faculty_registration_requests", where: "TRUE" },
];

const main = async () => {
	console.log(`Database: ${new URL(env.databaseUrl).hostname}`);
	console.log(apply ? "Mode: APPLY" : "Mode: dry run (rolled back)");

	const client = await getDbPool().connect();
	try {
		await client.query("BEGIN");
		const summary = [];

		for (const { table, where } of TARGETS) {
			const rows = (
				await client.query(`SELECT id, name FROM ${table} WHERE ${where} AND name IS NOT NULL ORDER BY id`)
			).rows;
			const changes = rows
				.map((row) => ({ id: row.id, before: row.name, after: toTitleCaseName(row.name) }))
				.filter((change) => change.after !== change.before);

			let updated = 0;
			for (const change of changes) {
				const result = await client.query(
					`UPDATE ${table} SET name = $1 WHERE id = $2 AND name = $3`,
					[change.after, change.id, change.before]
				);
				updated += result.rowCount;
			}

			const leftover = (
				await client.query(`SELECT id, name FROM ${table} WHERE ${where} AND name IS NOT NULL`)
			).rows.filter((row) => toTitleCaseName(row.name) !== row.name);

			if (changes.length) {
				console.log(`\n${table}:`);
				console.table(changes);
			}
			summary.push({ table, names: rows.length, changed: updated, still_wrong: leftover.length });
		}

		console.log("\nSummary:");
		console.table(summary);

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
