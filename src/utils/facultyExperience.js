/*
 * Total experience of a faculty member, worked out from the entries in
 * tab_data.qualifications.experience. This is the only place the API and the
 * stored experience_years column get the number from.
 *
 * Rules:
 *  - A range that ends in a month includes that month: Jan 2025 - Dec 2025 is 12 months.
 *  - "Present" counts completed months only, so the running month is left out.
 *  - A year without a month means January of that year: 2018 - 2023 is 5 years.
 *  - Overlapping entries are counted once: two roles held at the same time are
 *    one stretch of experience, not two.
 *  - A total above MAX_EXPERIENCE_YEARS can only be bad data and is reported as 0.
 *
 * gbu-website/src/utils/facultyExperience.js holds the same logic for the
 * browser. Change both together; each repo tests the same cases.
 */

const MAX_EXPERIENCE_YEARS = 70;

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const PRESENT_WORDS = new Set(["present", "current", "ongoing"]);

/** { present: true }, { year, month, hasMonth }, or null when there is no usable date. */
const parseExperienceDate = (value) => {
	const text = String(value ?? "").trim().toLowerCase();
	if (!text) return null;
	if (PRESENT_WORDS.has(text)) return { present: true };

	// "2021-06" is what the month picker saves; "06/2021" exists in older data.
	const yearFirst = text.match(/\b(19\d\d|20\d\d)[-/](0?[1-9]|1[0-2])\b/);
	if (yearFirst) return { year: Number(yearFirst[1]), month: Number(yearFirst[2]), hasMonth: true };

	const monthFirst = text.match(/\b(0?[1-9]|1[0-2])[-/](19\d\d|20\d\d)\b/);
	if (monthFirst) return { year: Number(monthFirst[2]), month: Number(monthFirst[1]), hasMonth: true };

	const yearOnly = text.match(/\b(19\d\d|20\d\d)\b/);
	if (!yearOnly) return null;

	const monthName = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
	if (monthName) return { year: Number(yearOnly[1]), month: MONTH_NAMES.indexOf(monthName[1]) + 1, hasMonth: true };

	return { year: Number(yearOnly[1]), month: 1, hasMonth: false };
};

const toMonthIndex = ({ year, month }) => year * 12 + month - 1;

/** [start, end) in month indexes, or null when the entry cannot be counted. */
const toMonthRange = (entry, nowIndex) => {
	const from = parseExperienceDate(entry?.from || entry?.fromYear);
	const to = parseExperienceDate(entry?.to || entry?.toYear);
	if (!from || from.present || !to) return null;

	const start = toMonthIndex(from);
	const end = to.present ? nowIndex : toMonthIndex(to) + (to.hasMonth ? 1 : 0);
	const cappedEnd = Math.min(end, nowIndex);
	return cappedEnd > start ? [start, cappedEnd] : null;
};

const calculateExperienceMonths = (entries, now = new Date()) => {
	if (!Array.isArray(entries)) return 0;

	const nowIndex = now.getFullYear() * 12 + now.getMonth();
	const ranges = entries
		.map((entry) => toMonthRange(entry, nowIndex))
		.filter(Boolean)
		.sort((a, b) => a[0] - b[0]);

	let total = 0;
	let coveredUntil = -Infinity;
	for (const [start, end] of ranges) {
		if (end <= coveredUntil) continue;
		total += end - Math.max(start, coveredUntil);
		coveredUntil = end;
	}

	return total <= MAX_EXPERIENCE_YEARS * 12 ? total : 0;
};

/** Completed years only: 1 year 11 months is 1, never 2. */
const calculateExperienceYears = (entries, now = new Date()) =>
	Math.floor(calculateExperienceMonths(entries, now) / 12);

module.exports = {
	MAX_EXPERIENCE_YEARS,
	parseExperienceDate,
	calculateExperienceMonths,
	calculateExperienceYears,
};
