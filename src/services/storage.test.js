const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "gbu-upload-types-"));
process.env.UPLOAD_STORAGE_PATH = root;
const storage = require("./storage");

// What gbu-website/public/uploads.php serves. Anything else would 404 on the website.
const SERVED = new Set(["webp", "jpg", "jpeg", "png", "gif", "avif", "pdf", "doc", "docx", "xls", "xlsx"]);
const extensionOf = (saved) => path.extname(saved.storedName).slice(1);
const assertServed = (saved) => assert.ok(SERVED.has(extensionOf(saved)), saved.storedName);

const countFiles = (dir = root) =>
	fs.readdirSync(dir, { withFileTypes: true }).reduce(
		(total, entry) => total + (entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1),
		0,
	);

const tiny = () => sharp({ create: { width: 2, height: 2, channels: 3, background: "#0099ff" } });
// Compact markup that sharp draws large, so its WebP comes out bigger than the upload.
const svg = Buffer.from(
	'<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1800"><defs><linearGradient id="a"><stop stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="1800" height="1800" fill="url(#a)"/></svg>',
);

const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(100, 32)]);
const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100, 0)]);
const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100, 0)]);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("an SVG is stored as WebP, never as SVG", async () => {
	const saved = await storage.saveImage(svg, { originalName: "logo.svg", mimeType: "image/svg+xml" });
	assert.equal(extensionOf(saved), "webp");
	assert.equal(saved.mimeType, "image/webp");
});

test("a TIFF is stored as WebP even when the WebP comes out larger", async () => {
	const tiff = await tiny().tiff({ compression: "lzw" }).toBuffer();
	const saved = await storage.saveImage(tiff, { originalName: "tiny.tif", mimeType: "image/tiff" });
	assert.equal(extensionOf(saved), "webp");
});

test("very small JPG, PNG and GIF always land on a served extension", async () => {
	for (const [name, mimeType, bytes] of [
		["a.jpg", "image/jpeg", await tiny().jpeg().toBuffer()],
		["a.png", "image/png", await tiny().png().toBuffer()],
		["a.gif", "image/gif", await tiny().gif().toBuffer()],
	]) {
		assertServed(await storage.saveImage(bytes, { originalName: name, mimeType }));
	}
});

test("images sharp cannot read are refused with a clear message, and nothing is written", async () => {
	const before = countFiles();
	const unreadable = [
		["scan.bmp", "image/bmp", Buffer.concat([Buffer.from("BM"), Buffer.alloc(200, 1)])],
		["IMG_0001.HEIC", "image/heic", Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(200, 2)])],
		["no-type.jpg", "", Buffer.alloc(200, 3)],
	];
	for (const [name, mimeType, bytes] of unreadable) {
		await assert.rejects(storage.saveImage(bytes, { originalName: name, mimeType }), (error) => {
			assert.equal(error.status, 415);
			assert.match(error.message, /JPG, PNG or WebP/);
			return true;
		});
	}
	assert.equal(countFiles(), before);
});

test("bytes that only claim to be a JPG are refused", async () => {
	await assert.rejects(
		storage.saveImage(Buffer.alloc(200, 4), { originalName: "fake.jpg", mimeType: "image/jpeg" }),
		(error) => error.status === 415,
	);
});

test("a damaged JPG that sharp cannot read is still stored under a served extension", async () => {
	const damaged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(200, 5)]);
	const saved = await storage.saveImage(damaged, { originalName: "photo", mimeType: "image/jpeg" });
	assert.equal(extensionOf(saved), "jpg");
});

test("a document's extension comes from its type, not its name", () => {
	for (const [originalName, mimeType, bytes, expected] of [
		["report", "application/pdf", pdf, "pdf"],
		["report.final", "application/pdf", pdf, "pdf"],
		["CV FINAL (1).PDF", "application/pdf", pdf, "pdf"],
		["सूचना.pdf", "application/pdf", pdf, "pdf"],
		["form", "application/msword", ole, "doc"],
		["form.bak", DOCX, zip, "docx"],
		["sheet", "application/vnd.ms-excel", ole, "xls"],
		["sheet.old", XLSX, zip, "xlsx"],
		["notes.php", "application/pdf", pdf, "pdf"],
	]) {
		assert.equal(extensionOf(storage.saveFile(bytes, { originalName, mimeType })), expected, originalName);
	}
});

test("a document type the website cannot serve is refused", () => {
	assert.throws(
		() => storage.saveFile(Buffer.from("hello"), { originalName: "a.txt", mimeType: "text/plain" }),
		(error) => error.status === 415,
	);
});
