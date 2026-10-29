const crypto = require("crypto");
const sharp = require("sharp");

/**
 * Self-hosted image captcha (no third-party service).
 *
 * Characters are drawn from a built-in stroke font as SVG paths and then
 * rasterised to PNG, so the answer never appears as text in the response.
 * Look-alike characters (0/O, 1/I, 5/S, 8/B, U/V …) are left out.
 */
const ALPHABET = "ACDEFHJKLMNPRTVWXY234679";
const CAPTCHA_LENGTH = 6;

// Each glyph is a list of strokes on a 4 × 6 grid (x right, y down)
const GLYPHS = {
	A: [[[0, 6], [2, 0], [4, 6]], [[0.7, 4], [3.3, 4]]],
	C: [[[4, 1], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5]]],
	D: [[[0, 0], [0, 6], [2.4, 6], [4, 4.4], [4, 1.6], [2.4, 0], [0, 0]]],
	E: [[[4, 0], [0, 0], [0, 6], [4, 6]], [[0, 3], [3, 3]]],
	F: [[[4, 0], [0, 0], [0, 6]], [[0, 3], [3, 3]]],
	H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
	J: [[[1.5, 0], [4, 0]], [[3, 0], [3, 5], [2, 6], [1, 6], [0, 5]]],
	K: [[[0, 0], [0, 6]], [[4, 0], [0, 3.6]], [[1.4, 2.4], [4, 6]]],
	L: [[[0, 0], [0, 6], [4, 6]]],
	M: [[[0, 6], [0, 0], [2, 3.6], [4, 0], [4, 6]]],
	N: [[[0, 6], [0, 0], [4, 6], [4, 0]]],
	P: [[[0, 6], [0, 0], [3, 0], [4, 1], [4, 2.4], [3, 3.4], [0, 3.4]]],
	R: [[[0, 6], [0, 0], [3, 0], [4, 1], [4, 2.4], [3, 3.4], [0, 3.4]], [[2, 3.4], [4, 6]]],
	T: [[[0, 0], [4, 0]], [[2, 0], [2, 6]]],
	V: [[[0, 0], [2, 6], [4, 0]]],
	W: [[[0, 0], [1, 6], [2, 2.4], [3, 6], [4, 0]]],
	X: [[[0, 0], [4, 6]], [[4, 0], [0, 6]]],
	Y: [[[0, 0], [2, 3], [4, 0]], [[2, 3], [2, 6]]],
	2: [[[0, 1.2], [1, 0], [3, 0], [4, 1], [4, 2.2], [0, 6], [4, 6]]],
	3: [[[0, 0.8], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [1.6, 3]], [[3, 3], [4, 4], [4, 5], [3, 6], [1, 6], [0, 5.2]]],
	4: [[[3, 6], [3, 0], [0, 4.2], [4, 4.2]]],
	6: [[[3.6, 0.4], [3, 0], [1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 4]]],
	7: [[[0, 0], [4, 0], [1.6, 6]]],
	9: [[[4, 2], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0.4, 5.6]]],
};

const WIDTH = 240;
const HEIGHT = 80;
const INK = ["#1d4ed8", "#b91c1c", "#15803d", "#7e22ce", "#c2410c", "#0f766e", "#334155"];

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const fmt = (n) => n.toFixed(2);

const randomText = () =>
	Array.from({ length: CAPTCHA_LENGTH }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join("");

const glyphSvg = (char, index) => {
	const scale = rand(5.4, 6.6);
	const cx = 24 + index * 38 + rand(-3, 3);
	const cy = HEIGHT / 2 + rand(-6, 6);
	const transform = `translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(rand(-20, 20))}) skewX(${fmt(rand(-10, 10))}) scale(${fmt(scale)}) translate(-2 -3)`;
	const d = GLYPHS[char]
		.map((stroke) =>
			stroke
				.map(([x, y], i) => `${i ? "L" : "M"}${fmt(x + rand(-0.15, 0.15))} ${fmt(y + rand(-0.15, 0.15))}`)
				.join(" "),
		)
		.join(" ");
	// Stroke width is in glyph units, so divide by the scale to get ~3px on screen
	return `<path d="${d}" transform="${transform}" fill="none" stroke="${pick(INK)}" stroke-width="${fmt(rand(2.8, 3.4) / scale)}" stroke-linecap="round" stroke-linejoin="round"/>`;
};

const noiseSvg = () => {
	const parts = [];
	for (let i = 0; i < 3; i += 1) {
		parts.push(
			`<ellipse cx="${fmt(rand(0, WIDTH))}" cy="${fmt(rand(0, HEIGHT))}" rx="${fmt(rand(30, 70))}" ry="${fmt(rand(15, 35))}" fill="${pick(INK)}" opacity="0.08"/>`,
		);
	}
	for (let i = 0; i < 2; i += 1) {
		const y = () => fmt(rand(15, HEIGHT - 15));
		parts.push(
			`<path d="M${fmt(rand(0, 15))} ${y()} C${fmt(rand(50, 100))} ${y()} ${fmt(rand(140, 190))} ${y()} ${fmt(rand(WIDTH - 15, WIDTH))} ${y()}" fill="none" stroke="${pick(INK)}" stroke-width="${fmt(rand(1.4, 2))}" opacity="0.7"/>`,
		);
	}
	for (let i = 0; i < 6; i += 1) {
		const x = rand(0, WIDTH);
		const y = rand(0, HEIGHT);
		parts.push(
			`<line x1="${fmt(x)}" y1="${fmt(y)}" x2="${fmt(x + rand(-25, 25))}" y2="${fmt(y + rand(-12, 12))}" stroke="${pick(INK)}" stroke-width="1.2" opacity="0.5"/>`,
		);
	}
	for (let i = 0; i < 40; i += 1) {
		parts.push(`<circle cx="${fmt(rand(0, WIDTH))}" cy="${fmt(rand(0, HEIGHT))}" r="${fmt(rand(0.8, 1.8))}" fill="${pick(INK)}" opacity="0.5"/>`);
	}
	return parts.join("");
};

/**
 * Returns { text, image } — `text` is the answer (uppercase), `image` a data URL.
 * The image is rendered at 2x so it stays sharp on high-density screens.
 */
const createCaptcha = async () => {
	const text = randomText();
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * 2}" height="${HEIGHT * 2}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`
		+ `<rect width="${WIDTH}" height="${HEIGHT}" fill="#f8fafc"/>`
		+ noiseSvg()
		+ [...text].map(glyphSvg).join("")
		+ `</svg>`;

	try {
		const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
		return { text, image: `data:image/png;base64,${png.toString("base64")}` };
	} catch (_) {
		// Paths only, no <text>, so the SVG fallback still hides the answer from plain parsing
		return { text, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
	}
};

module.exports = { createCaptcha, CAPTCHA_LENGTH };
