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

module.exports = { resolveSchoolCode, SCHOOL_CODE_MAP };
