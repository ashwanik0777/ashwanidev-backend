const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { isPersistentPath } = require("./persistentStorage");

// The same layout Hostinger uses, in a temp folder.
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gbu-storage-test-")));
const hbuilds = path.join(home, "domains/backend.onlinegbu.com/hbuilds");
const appRoot = path.join(hbuilds, "versions/01abc/nodejs");
fs.mkdirSync(appRoot, { recursive: true });
fs.symlinkSync(path.join(hbuilds, "versions/01abc"), path.join(hbuilds, "current"));

const production = { nodeEnv: "production", appRoot };

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test("a folder outside the deploy area is safe", () => {
	assert.equal(isPersistentPath(path.join(home, "gbu-storage/uploads"), production), true);
});

test("the old relative path is refused", () => {
	assert.equal(isPersistentPath(path.join(appRoot, "storage/uploads"), production), false);
});

test("the app folder itself is refused", () => {
	assert.equal(isPersistentPath(appRoot, production), false);
});

test("beside the app, inside the same version, is refused", () => {
	assert.equal(isPersistentPath(path.join(hbuilds, "versions/01abc/storage"), production), false);
});

test("anywhere under hbuilds is refused", () => {
	assert.equal(isPersistentPath(path.join(hbuilds, "storage/uploads"), production), false);
});

test("going through the current symlink is refused", () => {
	assert.equal(isPersistentPath(path.join(hbuilds, "current/nodejs/storage/uploads"), production), false);
});

test("public_html is refused", () => {
	assert.equal(isPersistentPath(path.join(home, "domains/web.onlinegbu.com/public_html/uploads"), production), false);
});

test("a symlink outside that points back into the deploy area is refused", () => {
	const link = path.join(home, "sneaky-link");
	fs.symlinkSync(path.join(appRoot), link);
	assert.equal(isPersistentPath(path.join(link, "storage"), production), false);
});

test("a similar folder name is not mistaken for the deploy area", () => {
	assert.equal(isPersistentPath(path.join(home, "domains/backend.onlinegbu.com/hbuilds-data/uploads"), production), true);
});

test("local development can keep files in the project", () => {
	assert.equal(isPersistentPath(path.join(appRoot, "storage/uploads"), { nodeEnv: "development", appRoot }), true);
});

test("outside Hostinger the app folder is still refused in production", () => {
	const plain = path.join(home, "srv/app");
	fs.mkdirSync(plain, { recursive: true });
	assert.equal(isPersistentPath(path.join(plain, "storage"), { nodeEnv: "production", appRoot: plain }), false);
	assert.equal(isPersistentPath(path.join(home, "srv/data"), { nodeEnv: "production", appRoot: plain }), true);
});
