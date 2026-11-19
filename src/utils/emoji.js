/*
 * Removes emoji and other picture icons from text: "🎉 Annual Fest ✨" becomes
 * "Annual Fest". Announcement titles and descriptions must not carry icons.
 *
 * Kept: letters in every script (Hindi included), digits, punctuation, ₹, •,
 * and the copyright, registered and trade mark signs, which Unicode lists as
 * pictographs but are ordinary text here ("© 2024 - Gautam Buddha University").
 * The zero-width joiner goes only inside an emoji; Hindi words use it too. A
 * keycap emoji (a digit followed by U+20E3) keeps its digit.
 *
 * Spaces: an icon between two words leaves one space; at the start or end of a
 * line it leaves none. All other spacing and line breaks are left as they are.
 *
 * gbu-website/src/utils/emoji.js holds the same rules for the dashboard forms.
 * Change both together; each repo tests the same cases.
 */

const PICTOGRAPH = String.raw`(?![\u{A9}\u{AE}\u{2122}])\p{Extended_Pictographic}`;
const MODIFIERS = String.raw`(?:\p{Emoji_Modifier}|\u{FE0E}|\u{FE0F})*`;
const EMOJI = String.raw`(?:${PICTOGRAPH}${MODIFIERS}(?:\u{200D}${PICTOGRAPH}${MODIFIERS})*|\p{Regional_Indicator}|[\u{E0020}-\u{E007F}])`;

const KEYCAP = /([0-9#*])\u{FE0F}?\u{20E3}/gu;
const ICON_RUN = new RegExp(String.raw`[ \t]*${EMOJI}(?:[ \t]*${EMOJI})*[ \t]*`, "gu");
// Selectors and skin tones left over once their icon has gone.
const LEFTOVER = /\u{FE0E}|\u{FE0F}|\u{20E3}|\p{Emoji_Modifier}/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;

const isLineEdge = (char) => char === undefined || char === "\n" || char === "\r";

const stripEmoji = (value) => {
	if (typeof value !== "string") return value;
	return value
		.replace(KEYCAP, "$1")
		.replace(ICON_RUN, (match, offset, text) => {
			const before = text[offset - 1];
			const after = text[offset + match.length];
			if (isLineEdge(before) || isLineEdge(after)) return "";
			if (/[ \t]/.test(match[0]) || /[ \t]/.test(match[match.length - 1])) return " ";
			return WORD_CHAR.test(before) && WORD_CHAR.test(after) ? " " : "";
		})
		.replace(LEFTOVER, "");
};

module.exports = { stripEmoji };
