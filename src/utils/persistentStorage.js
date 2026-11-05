const fs = require("fs");
const path = require("path");
const env = require("../config/env");

/*
 * Hostinger builds every deploy into a new version folder and deletes the old
 * one, on each push and each env save. Anything written inside it goes too, which
 * is how faculty photos and CVs were lost in Nov 2026. So in production, files may
 * only be stored outside the deployed area. Uploads are refused rather than quietly
 * kept somewhere the next deploy deletes.
 */
const APP_ROOT = path.resolve(__dirname, "../..");

// Follows symlinks through the part of the path that exists ("current" points at a version folder).
const realPath = (target) => {
	const resolved = path.resolve(target);
	try {
		return fs.realpathSync(resolved);
	} catch {
		const parent = path.dirname(resolved);
		return parent === resolved ? resolved : path.join(realPath(parent), path.basename(resolved));
	}
};

const isInside = (target, folder) => {
	const relative = path.relative(folder, target);
	return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

// On Hostinger the app runs from .../hbuilds/versions/<id>/nodejs, and all of hbuilds is managed by deploys.
const deployedArea = (appRoot) => {
	const real = realPath(appRoot);
	const marker = `${path.sep}hbuilds${path.sep}`;
	const index = real.indexOf(marker);
	return index === -1 ? real : real.slice(0, index + marker.length - 1);
};

const isPersistentPath = (target, { nodeEnv = env.nodeEnv, appRoot = APP_ROOT } = {}) => {
	if (nodeEnv !== "production") return true;
	const real = realPath(target);
	// public_html is rebuilt by each deploy as well.
	return !isInside(real, deployedArea(appRoot)) && !real.split(path.sep).includes("public_html");
};

const assertPersistentPath = (target) => {
	if (isPersistentPath(target)) return;
	const error = new Error("File uploads are paused because file storage is not set up safely. Please contact the IT Cell.");
	error.status = 503;
	throw error;
};

module.exports = { isPersistentPath, assertPersistentPath };
