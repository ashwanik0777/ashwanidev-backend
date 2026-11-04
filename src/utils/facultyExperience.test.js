const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateExperienceMonths, calculateExperienceYears, parseExperienceDate } = require("./facultyExperience");

// gbu-website/src/utils/facultyExperience.test.js runs the same cases.
const NOW = new Date(2026, 10, 4); // 4 Nov 2026

const CASES = [
	["2 months + 11 months is 13 months", [["2024-03", "2024-04"], ["2025-01", "2025-11"]], 13],
	["the end month is included", [["2025-01", "2025-12"]], 12],
	["a single month counts", [["2025-03", "2025-03"]], 1],
	["crossing a calendar year changes nothing", [["2024-12", "2025-02"]], 3],
	["year-only entries stay a plain difference", [["2018", "2023"]], 60],
	["same year with no months is not counted", [["2024", "2024"]], 0],
	["year-only start with a month end", [["2018", "2018-06"]], 6],
	["month start with a year-only end", [["2021-06", "2023"]], 19],
	["Present leaves out the running month", [["2021-06", "Present"]], 65],
	["joined three months ago", [["2026-08", "Present"]], 3],
	["joined eleven months ago is not a year", [["2025-12", "Present"]], 11],
	["joined this month", [["2026-11", "Present"]], 0],
	["present is case-insensitive", [["2024-01", "CURRENT"]], 34],
	["MM/YYYY from older data", [["08/2025", "Present"]], 15],
	["month names", [["Mar 2024", "April 2024"]], 2],
	["overlapping roles count once", [["2015-01", "Present"], ["2020-01", "Present"]], 142],
	["a role inside another adds nothing", [["2015-01", "2020-12"], ["2017-01", "2018-12"]], 72],
	["sharing an end month counts it once", [["12/2022", "08/2025"], ["08/2025", "Present"]], 47],
	["back-to-back months add up", [["2025-01", "2025-12"], ["2026-01", "2026-03"]], 15],
	["gaps are not counted", [["2010-01", "2010-12"], ["2020-01", "2020-12"]], 24],
	["reversed dates are not counted", [["2026", "2022"]], 0],
	["a missing end date is not counted", [["2024-01", ""]], 0],
	["a missing start date is not counted", [["", "2024-01"]], 0],
	["future end dates stop at today", [["2026-01", "2030-12"]], 10],
	["a start date in the future is not counted", [["2030-01", "Present"]], 0],
	["this month as an end date is still running", [["2026-01", "2026-11"]], 10],
	["a total above the limit is bad data", [["1900", "2000"]], 0],
	["exactly the limit is kept", [["1950", "2020"]], 840],
];

const toEntries = (ranges) => ranges.map(([from, to]) => ({ from, to }));

for (const [name, ranges, expected] of CASES) {
	test(name, () => {
		assert.equal(calculateExperienceMonths(toEntries(ranges), NOW), expected);
	});
}

test("old fromYear/toYear keys still count", () => {
	assert.equal(calculateExperienceMonths([{ fromYear: "2018", toYear: "2023" }], NOW), 60);
});

test("numeric years still count", () => {
	assert.equal(calculateExperienceMonths([{ from: 2018, to: 2023 }], NOW), 60);
});

test("anything that is not a list is zero", () => {
	for (const value of [undefined, null, "", {}, 5]) {
		assert.equal(calculateExperienceMonths(value, NOW), 0);
	}
});

test("years are completed years only", () => {
	assert.equal(calculateExperienceYears(toEntries([["2024-01", "2024-12"]]), NOW), 1);
	assert.equal(calculateExperienceYears(toEntries([["2024-01", "2025-11"]]), NOW), 1);
	assert.equal(calculateExperienceYears(toEntries([["2024-01", "2024-11"]]), NOW), 0);
});

test("dates parse with and without a month", () => {
	assert.deepEqual(parseExperienceDate("2021-06"), { year: 2021, month: 6, hasMonth: true });
	assert.deepEqual(parseExperienceDate("06/2021"), { year: 2021, month: 6, hasMonth: true });
	assert.deepEqual(parseExperienceDate("2021"), { year: 2021, month: 1, hasMonth: false });
	assert.deepEqual(parseExperienceDate(" Present "), { present: true });
	assert.equal(parseExperienceDate("soon"), null);
	assert.equal(parseExperienceDate(""), null);
});
