const test = require("node:test");
const assert = require("node:assert/strict");
const { stripEmoji } = require("./emoji");

// gbu-website/src/utils/emoji.test.js runs the same cases.
const CASES = [
	["icon at the start", "🎗️ GBU hosts Symposium Series 1.0", "GBU hosts Symposium Series 1.0"],
	["icons at both ends", "✨ Creative “Food Without Fire”🍽️", "Creative “Food Without Fire”"],
	["icon between words leaves one space", "Students 🚀 explore", "Students explore"],
	["icon glued between words leaves one space", "GBU🏆Champions", "GBU Champions"],
	["icon glued to punctuation leaves none", "Welcome!🎉 Join us", "Welcome! Join us"],
	["several icons in a row", "Results 🥇🏅🏆 announced", "Results announced"],
	["icons separated by spaces", "Win 🏆 🥇 🏅 big", "Win big"],
	["joined emoji with gender sign", "🏃‍♂️ Marathon", "Marathon"],
	["flag", "Proud 🇮🇳 moment", "Proud moment"],
	["skin tone", "Thanks 👏🏽 everyone", "Thanks everyone"],
	["bullet icons at line starts", "🔹 First point\n🔹 Second point", "First point\nSecond point"],
	["line that is only icons", "Line one\n🎉🎉\nLine three", "Line one\n\nLine three"],
	["windows line breaks", "One 🌟\r\nTwo", "One\r\nTwo"],
	["check mark and sparkles", "✔ Registered ✨", "Registered"],
	["keycap keeps the digit", "Step 1️⃣ begins", "Step 1 begins"],
	["copyright is text", "© 2024 - Gautam Buddha University", "© 2024 - Gautam Buddha University"],
	["registered and trade marks are text", "GBU® Fest™", "GBU® Fest™"],
	["rupee, bullet and dashes stay", "• Fee ₹500 – free “entry”…", "• Fee ₹500 – free “entry”…"],
	["Hindi with a joiner is unchanged", "द न्‍यूज गली, विभिन्‍न स्‍थानों से।", "द न्‍यूज गली, विभिन्‍न स्‍थानों से।"],
	["Hindi with an icon", "🙏 धन्यवाद", "धन्यवाद"],
	["plain arrow stays", "Admissions → Apply", "Admissions → Apply"],
	["text without icons is untouched", "  Annual   Report  2025 ", "  Annual   Report  2025 "],
	["only icons becomes empty", "🎉🎉", ""],
];

for (const [name, input, expected] of CASES) {
	test(name, () => {
		assert.equal(stripEmoji(input), expected);
	});
}

test("running it twice changes nothing more", () => {
	for (const [, input] of CASES) {
		const once = stripEmoji(input);
		assert.equal(stripEmoji(once), once);
	}
});

test("missing values pass through", () => {
	assert.equal(stripEmoji(""), "");
	assert.equal(stripEmoji(null), null);
	assert.equal(stripEmoji(undefined), undefined);
	assert.equal(stripEmoji(5), 5);
});
