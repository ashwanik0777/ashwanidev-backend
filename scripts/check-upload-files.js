/*
 * Read-only: compare a folder with every uploaded file the database points at,
 * to see what a backup can restore and what is still gone. Files are matched by
 * name, so the folder's layout does not matter. Links on other sites are ignored.
 *
 *   node scripts/check-upload-files.js <folder>
 *   node scripts/check-upload-files.js <folder> --stage <new-folder>   copy matches there, laid out like gbu-storage
 *   node scripts/check-upload-files.js <folder> --missing <file.csv>   list what is still missing
 *
 * Connects to DATABASE_URL (shell first, then .env) and prints the host.
 */
const fs = require("fs");
const path = require("path");
const env = require("../src/config/env");
const { getDbPool, closeDb } = require("../src/config/db");

const OUR_HOSTS = new Set(["backend.onlinegbu.com", "web.onlinegbu.com"]);
// uploads is read separately; page_visits logs paths people opened, not files in use.
const NOT_FILE_REFERENCES = new Set(["uploads", "page_visits"]);
const UPLOAD_URL = /(?:https?:\/\/([^/"'\s\\]+)|(?<![\w.\-/%]))\/uploads\/([^"'\s\\?#<>)]+)/g;

const flagValue = (flag) => {
	const index = process.argv.indexOf(flag);
	return index === -1 ? null : process.argv[index + 1];
};

const indexFolder = (dir, index = new Map()) => {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) indexFolder(full, index);
		else if (entry.isFile() && fs.statSync(full).size > 0) {
			index.set(entry.name, [...(index.get(entry.name) || []), full]);
		}
	}
	return index;
};

const decode = (value) => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const readNeededFiles = async (client) => {
	const needed = new Map();
	const need = (root, relative, ref, size) => {
		const key = `${root}/${relative}`;
		const item = needed.get(key) || { root, relative, refs: [], size: null };
		if (ref) item.refs.push(ref);
		if (size) item.size = size;
		needed.set(key, item);
	};

	const tables = await client.query(
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`
	);
	for (const { table_name: table } of tables.rows) {
		if (NOT_FILE_REFERENCES.has(table)) continue;
		const rows = await client.query(
			`SELECT to_jsonb(t) AS row FROM public."${table}" t WHERE t::text LIKE '%/uploads/%'`
		);
		for (const { row } of rows.rows) {
			for (const [column, value] of Object.entries(row)) {
				if (value === null) continue;
				const text = typeof value === "string" ? value : JSON.stringify(value);
				for (const [, host, relative] of text.matchAll(UPLOAD_URL)) {
					if (host && !OUR_HOSTS.has(host)) continue;
					need("uploads", decode(relative), { table, column, row });
				}
			}
		}
	}

	const recorded = await client.query("SELECT relative_path, file_size FROM public.uploads");
	for (const { relative_path: relative, file_size: size } of recorded.rows) {
		need("uploads", relative, null, size);
	}

	const grievances = await client.query(
		"SELECT to_jsonb(g) AS row, attachment_path FROM public.grievances g WHERE attachment_path IS NOT NULL"
	);
	for (const { row, attachment_path: relative } of grievances.rows) {
		need("private", relative, { table: "grievances", column: "attachment_path", row });
	}
	return [...needed.values()];
};

const main = async () => {
	const folder = process.argv[2];
	const stage = flagValue("--stage");
	const missingCsv = flagValue("--missing");
	if (!folder || folder.startsWith("--") || !fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
		throw new Error("Pass a folder: node scripts/check-upload-files.js <folder>");
	}
	if (stage && fs.existsSync(stage) && fs.readdirSync(stage).length) {
		throw new Error(`--stage folder must be new or empty: ${stage}`);
	}

	console.log(`Database: ${new URL(env.databaseUrl).hostname}`);
	const index = indexFolder(folder);
	console.log(`Folder: ${[...index.values()].flat().length} files, ${index.size} different names`);

	const client = await getDbPool().connect();
	let needed;
	try {
		await client.query("BEGIN READ ONLY");
		needed = await readNeededFiles(client);
		await client.query("ROLLBACK");
	} finally {
		client.release();
		await closeDb();
	}

	const groups = {};
	const usedNames = new Set();
	const missing = [];
	let differing = 0;
	for (const item of needed) {
		const name = path.basename(item.relative);
		const candidates = index.get(name) || [];
		usedNames.add(name);
		item.source = candidates.find((file) => fs.statSync(file).size === item.size) || candidates[0];
		if (!item.size && new Set(candidates.map((file) => fs.statSync(file).size)).size > 1) differing += 1;

		const group = item.root === "private"
			? "private grievance files"
			: item.refs.length ? "used on the site" : "uploaded, nothing points at it now";
		groups[group] ??= { found: 0, missing: 0 };
		groups[group][item.source ? "found" : "missing"] += 1;
		if (!item.source && item.refs.length) missing.push(item);
	}
	console.table(groups);

	const missingByColumn = {};
	for (const item of missing) {
		for (const { table, column } of item.refs) {
			const key = `${table}.${column}`;
			missingByColumn[key] = (missingByColumn[key] || 0) + 1;
		}
	}
	if (missing.length) {
		console.log("Still missing, by where the database uses them:");
		console.table(missingByColumn);
	}
	if (differing) console.log(`Same name but different sizes in the folder, first one used: ${differing}`);

	const unused = [...index.keys()].filter((name) => !usedNames.has(name));
	console.log(`Files in the folder the database does not know: ${unused.length}`);
	if (unused.length) console.log(unused.slice(0, 15).map((name) => `  ${name}`).join("\n"));

	if (missingCsv) {
		const lines = [["table", "column", "id", "name", "email", "path"].map(csvCell).join(",")];
		for (const item of missing) {
			for (const { table, column, row } of item.refs) {
				lines.push([table, column, row.id, row.name || row.title, row.email, `${item.root}/${item.relative}`].map(csvCell).join(","));
			}
		}
		fs.writeFileSync(missingCsv, `${lines.join("\n")}\n`);
		console.log(`Missing list: ${missingCsv}`);
	}

	if (stage) {
		const stageRoot = path.resolve(stage);
		let copied = 0;
		for (const item of needed) {
			if (!item.source) continue;
			const destination = path.resolve(stageRoot, item.root, item.relative);
			if (!destination.startsWith(path.join(stageRoot, item.root) + path.sep)) continue;
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			fs.copyFileSync(item.source, destination, fs.constants.COPYFILE_EXCL);
			copied += 1;
		}
		console.log(`Copied ${copied} files to ${stageRoot}`);
	}
};

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
