const test = require("node:test");
const assert = require("node:assert/strict");
const { toTitleCaseName } = require("./personName");

const CASES = [
	["all capitals", "ANKIT BAKSHI", "Ankit Bakshi"],
	["all lower case", "dr. eti sharma", "Dr. Eti Sharma"],
	["already correct is unchanged", "Dr. Eti Sharma", "Dr. Eti Sharma"],
	["initials stay capitals", "DR. S.P. SINGH", "Dr. S.P. Singh"],
	["spaced initials", "prof. b. r. ambedkar", "Prof. B. R. Ambedkar"],
	["title without a space", "Dr.annu", "Dr.Annu"],
	["one-letter surname", "dr. siddaramu b", "Dr. Siddaramu B"],
	["Hon'ble keeps a small b", "HON'BLE VICE CHANCELLOR", "Hon'ble Vice Chancellor"],
	["O'Brien", "o'brien", "O'Brien"],
	["D'Souza after a title", "mr. d'souza", "Mr. D'Souza"],
	["hyphenated surname", "anil kumar-sharma", "Anil Kumar-Sharma"],
	["bracketed part", "prof. x (chair, patna)", "Prof. X (Chair, Patna)"],
	["slash between names", "ram/shyam", "Ram/Shyam"],
	["abbreviation with a full stop", "MOHD. ARIF", "Mohd. Arif"],
	["extra spaces", "  ms.   neha   gupta  ", "Ms. Neha Gupta"],
	["digits are kept", "test1", "Test1"],
	["mixed case word", "rAVI kUMAR", "Ravi Kumar"],
	["Hindi has no case and is unchanged", "डॉ. राम कुमार", "डॉ. राम कुमार"],
];

for (const [name, input, expected] of CASES) {
	test(name, () => {
		assert.equal(toTitleCaseName(input), expected);
	});
}

test("running it twice changes nothing more", () => {
	for (const [, input] of CASES) {
		const once = toTitleCaseName(input);
		assert.equal(toTitleCaseName(once), once);
	}
});

test("empty and missing values pass through", () => {
	assert.equal(toTitleCaseName(""), "");
	assert.equal(toTitleCaseName(null), null);
	assert.equal(toTitleCaseName(undefined), undefined);
});
