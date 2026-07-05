const { query } = require("../config/db");

/**
 * School code mapping — maps common school name variants to official short codes.
 * Add new schools here as needed.
 */
const SCHOOL_CODE_MAP = {
	soict: "SOICT",
	sobt: "SOBT",
	sobsc: "SOBSC",
	soe: "SOE",
	sol: "SOL",
	som: "SOM",
	sohss: "SOHSS",
	sovs: "SOVS",
	nss: "NSS",
	ncc: "NCC",
	// Full-name to code mapping
	"school of information & communication technology": "SOICT",
	"school of information and communication technology": "SOICT",
	"school of biotechnology": "SOBT",
	"school of buddhist studies & civilization": "SOBSC",
	"school of buddhist studies and civilization": "SOBSC",
	"school of engineering": "SOE",
	"school of law, justice & governance": "SOL",
	"school of law justice & governance": "SOL",
	"school of law, justice and governance": "SOL",
	"school of management": "SOM",
	"school of humanities & social sciences": "SOHSS",
	"school of humanities and social sciences": "SOHSS",
	"school of vocational studies & applied sciences": "SOVS",
	"school of vocational studies and applied sciences": "SOVS",
};

/**
 * Resolve a raw school string (code or full name) to its canonical short code.
 * Returns the uppercase code or "GBU" as fallback.
 */
const resolveSchoolCode = (rawSchool) => {
	if (!rawSchool || !String(rawSchool).trim()) return "GBU";
	const key = String(rawSchool).trim().toLowerCase();
	return SCHOOL_CODE_MAP[key] || key.toUpperCase() || "GBU";
};

/**
 * Generate the next sequential faculty ID for a given school code.
 * Format: {SCHOOLCODE}-F{SERIAL_PADDED} e.g. SOICT-F0001, SOE-F0012
 *
 * The function queries the DB for the highest existing serial number
 * for the given school code and increments it.
 */
const generateFacultyId = async (schoolCodeRaw) => {
	const schoolCode = resolveSchoolCode(schoolCodeRaw);
	const prefix = `${schoolCode}-F`;

	// Find the highest existing serial for this school
	const result = await query(
		`SELECT id FROM faculty_profiles
		 WHERE id LIKE $1
		 ORDER BY id DESC
		 LIMIT 1`,
		[`${prefix}%`]
	);

	let nextSerial = 1;
	if (result.rows.length > 0) {
		const lastId = result.rows[0].id; // e.g. "SOICT-F0003"
		const serialStr = lastId.replace(prefix, ""); // "0003"
		const lastSerial = parseInt(serialStr, 10);
		if (Number.isFinite(lastSerial) && lastSerial > 0) {
			nextSerial = lastSerial + 1;
		}
	}

	// Pad to at least 4 digits
	const serialPadded = String(nextSerial).padStart(4, "0");
	return `${prefix}${serialPadded}`;
};

module.exports = { generateFacultyId, resolveSchoolCode, SCHOOL_CODE_MAP };
