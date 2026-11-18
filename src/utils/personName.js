/*
 * A person's name in title case: "DR. S.P. SINGH" becomes "Dr. S.P. Singh".
 *
 * Rules:
 *  - Every word, and every part after a full stop, hyphen, slash or opening
 *    bracket, starts with a capital; the rest is lower case. So initials stay
 *    capitals ("S.P."), and "Dr.annu" becomes "Dr.Annu".
 *  - After a one-letter prefix and an apostrophe the next letter is a capital
 *    too ("O'Brien", "D'Souza"), but not in a longer word ("Hon'ble").
 *  - Spaces at the ends are removed and runs of spaces become one.
 *
 * Postgres initcap() is not used because it gives "Hon'Ble" and "S.p.".
 */

const toTitleCaseName = (value) => {
	if (typeof value !== "string") return value;
	return value
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
		.replace(/(^|[\s.\-/(])(\p{L})/gu, (match, before, letter) => before + letter.toUpperCase())
		.replace(/(^|[\s.\-/(])(\p{L})'(\p{L})/gu, (match, before, first, next) => `${before}${first}'${next.toUpperCase()}`);
};

module.exports = { toTitleCaseName };
