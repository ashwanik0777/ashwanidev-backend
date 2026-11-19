/*
 * One-off, safe to re-run: remove icons and emoji from announcement titles and
 * descriptions (news, events, notices, newsletters, media gallery). The rules
 * are in src/utils/emoji.js; new saves already go through them.
 *
 *   node scripts/strip-announcement-emoji.js            dry run, rolled back
 *   node scripts/strip-announcement-emoji.js --apply    writes the changes
 *
 * Connects to DATABASE_URL (shell first, then .env) and prints the host. Check
 * it before using --apply. Every change is listed. A change that would alter
 * anything except icons and the spaces around them stops the run and nothing
 * is written. updated_at is not touched, because nobody edited the item.
 */
const env = require("../src/config/env");
const { getDbPool, closeDb } = require("../src/config/db");
const { stripEmoji } = require("../src/utils/emoji");

const apply = process.argv.includes("--apply");

const TARGETS = [
	{ table: "news", columns: ["title", "excerpt", "content"] },
	{ table: "events", columns: ["title", "description"] },
	{ table: "notices", columns: ["title", "content"] },
	{ table: "newsletters", columns: ["title", "excerpt"] },
	{ table: "media_gallery", columns: ["title"] },
];

// Checked independently of the removal itself: what is left once these
// characters and all spaces are gone must be the same before and after.
const ICON_CHAR = /(?![\u{A9}\u{AE}\u{2122}])\p{Extended_Pictographic}|\u{FE0E}|\u{FE0F}|\u{20E3}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u{E0020}-\u{E007F}]/u;
const JOINER_IN_EMOJI = /(?<=\p{Extended_Pictographic}(?:\u{FE0F}|\p{Emoji_Modifier})*)\u{200D}(?=\p{Extended_Pictographic})/gu;
const textOnly = (value) =>
	[...value.replace(JOINER_IN_EMOJI, "")].filter((char) => !ICON_CHAR.test(char) && !/\s/.test(char)).join("");

const preview = (value) => {
	const flat = value.replace(/\s+/g, " ").trim();
	return flat.length > 70 ? `${flat.slice(0, 67)}...` : flat;
};

const main = async () => {
	console.log(`Database: ${new URL(env.databaseUrl).hostname}`);
	console.log(apply ? "Mode: APPLY" : "Mode: dry run (rolled back)");

	const client = await getDbPool().connect();
	try {
		await client.query("BEGIN");
		const summary = [];
		const listed = [];

		for (const { table, columns } of TARGETS) {
			for (const column of columns) {
				const rows = (
					await client.query(`SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL ORDER BY id`)
				).rows;

				let updated = 0;
				for (const row of rows) {
					const after = stripEmoji(row.value);
					if (after === row.value) continue;
					if (textOnly(after) !== textOnly(row.value)) {
						throw new Error(`${table}.${column} id ${row.id}: more than icons would change, nothing written`);
					}
					const removed = [...row.value].filter((char) => ICON_CHAR.test(char)).join("");
					const result = await client.query(
						`UPDATE ${table} SET ${column} = $1 WHERE id = $2 AND ${column} = $3`,
						[after, row.id, row.value]
					);
					updated += result.rowCount;
					listed.push({
						field: `${table}.${column}`,
						id: row.id,
						removed,
						after: column === "title" ? after : preview(after),
					});
				}

				const leftover = (
					await client.query(`SELECT id, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`)
				).rows.filter((row) => stripEmoji(row.value) !== row.value).length;
				summary.push({ field: `${table}.${column}`, rows: rows.length, changed: updated, still_with_icons: leftover });
			}
		}

		if (listed.length) console.table(listed);
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
