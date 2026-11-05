/*
 * One-off, safe to re-run: point stored file URLs at the website's domain, so
 * https://backend.onlinegbu.com/uploads/x becomes https://web.onlinegbu.com/uploads/x.
 * Run only after https://web.onlinegbu.com/uploads/ is live. The backend keeps
 * serving the old URLs too, so links already shared keep working.
 *
 *   node scripts/move-upload-urls-to-frontend.js            dry run, rolled back
 *   node scripts/move-upload-urls-to-frontend.js --apply    writes the changes
 *
 * Connects to DATABASE_URL (shell first, then .env) and prints the host. Check
 * it before using --apply. updated_at is not touched. Any other table still
 * holding the old URL is listed and left alone.
 */
const env = require("../src/config/env");
const { getDbPool, closeDb } = require("../src/config/db");

const OLD_PREFIX = "https://backend.onlinegbu.com/uploads/";
const NEW_PREFIX = "https://web.onlinegbu.com/uploads/";

const TARGETS = [
	{ table: "faculty_profiles", column: "image_url", type: "text" },
	{ table: "faculty_profiles", column: "cv_link", type: "text" },
	{ table: "faculty_profiles", column: "tab_data", type: "jsonb" },
	{ table: "events", column: "brochure_url", type: "text" },
	{ table: "events", column: "cover_image", type: "text" },
	{ table: "events", column: "flyer_url", type: "text" },
	{ table: "events", column: "image_link", type: "text" },
	{ table: "events", column: "gallery", type: "jsonb" },
	{ table: "notices", column: "pdf_url", type: "text" },
];

const apply = process.argv.includes("--apply");

const main = async () => {
	console.log(`Database: ${new URL(env.databaseUrl).hostname}`);
	console.log(apply ? "Mode: APPLY" : "Mode: dry run (rolled back)");

	const client = await getDbPool().connect();
	try {
		await client.query("BEGIN");

		const summary = [];
		for (const { table, column, type } of TARGETS) {
			const result = await client.query(
				`UPDATE public.${table} SET ${column} = replace(${column}::text, $1, $2)::${type}
				 WHERE position($1 in ${column}::text) > 0`,
				[OLD_PREFIX, NEW_PREFIX]
			);
			summary.push({ table, column, updated: result.rowCount });
		}
		console.table(summary);

		const tables = await client.query(
			`SELECT table_name FROM information_schema.tables
			 WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`
		);
		const leftover = [];
		for (const { table_name: table } of tables.rows) {
			const result = await client.query(
				`SELECT count(*)::int AS n FROM public."${table}" t WHERE position($1 in t::text) > 0`,
				[OLD_PREFIX]
			);
			if (result.rows[0].n) leftover.push({ table, rows: result.rows[0].n });
		}
		console.log(leftover.length ? "Still holding the old URL, left alone:" : "No old URLs left anywhere.");
		if (leftover.length) console.table(leftover);

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
