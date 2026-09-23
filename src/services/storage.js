/**
 * Centralized Storage Service
 *
 * All file upload/delete operations go through this module.
 * - Images:  optimized via sharp (resize + WebP + quality) → stored under images/{folder}/
 * - Files:   stored as-is after validation → stored under {folder}/
 * - Folders: mirror application page routes for logical organization
 *
 * Sharp loads with a graceful fallback: if the native binary isn't available
 * (e.g. restricted shared hosting), images are stored without optimization
 * and the limitation is logged at startup.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const env = require("../config/env");
const { logInfo, logError } = require("../config/logger");

// ---------------------------------------------------------------------------
// Sharp — attempt to load, fallback gracefully
// ---------------------------------------------------------------------------
let sharp = null;
let sharpAvailable = false;

try {
  sharp = require("sharp");
  sharpAvailable = true;
} catch {
  // sharp native binary not available on this host
}

// ---------------------------------------------------------------------------
// Resolve absolute storage root once
// ---------------------------------------------------------------------------
const STORAGE_ROOT = path.resolve(env.uploadStoragePath);

// ---------------------------------------------------------------------------
// Image magic-byte signatures
// ---------------------------------------------------------------------------
const IMAGE_SIGNATURES = {
  "image/jpeg": [Buffer.from([0xff, 0xd8, 0xff])],
  "image/png": [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  "image/webp": [Buffer.from("RIFF"), Buffer.from("WEBP")], // RIFF....WEBP
  "image/gif": [Buffer.from("GIF87a"), Buffer.from("GIF89a")],
  "image/avif": [], // complex container, rely on MIME
};

// Document magic-byte signatures
const DOC_SIGNATURES = {
  "application/pdf": [Buffer.from("%PDF")],
  // MS Office (old binary .doc/.xls) starts with D0 CF 11 E0
  "application/msword": [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],
  "application/vnd.ms-excel": [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],
  // OOXML (.docx/.xlsx) is a ZIP file starting with PK
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    Buffer.from([0x50, 0x4b]),
  ],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    Buffer.from([0x50, 0x4b]),
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a filename: lowercase, strip dangerous chars, truncate.
 */
function sanitizeFilename(name) {
  if (!name) return "file";
  // Remove extension for processing
  const ext = path.extname(name);
  let base = path.basename(name, ext);
  // Lowercase, replace non-alphanumeric with hyphens, collapse, trim
  base = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!base) base = "file";
  // Truncate base to 80 chars
  if (base.length > 80) base = base.substring(0, 80);
  return base;
}

/**
 * Generate a unique safe filename.
 * Format: {timestamp}-{8hexchars}-{sanitized}.{ext}
 */
function generateFilename(originalName, ext, customName) {
  const cleanExt = ext.replace(/^\./, "").toLowerCase();
  if (customName) {
    const safe = sanitizeFilename(customName);
    return `${safe}.${cleanExt}`;
  }
  // Fallback: timestamp-based unique name
  const ts = Date.now();
  const hex = crypto.randomBytes(4).toString("hex");
  const safe = sanitizeFilename(originalName);
  return `${ts}-${hex}-${safe}.${cleanExt}`;
}

/**
 * Ensure filename is unique within a directory.
 * If 'name.ext' exists, tries 'name_2.ext', 'name_3.ext', etc.
 */
function uniqueFilename(dirPath, filename) {
  let target = path.join(dirPath, filename);
  if (!fs.existsSync(target)) return filename;
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let counter = 2;
  while (fs.existsSync(target)) {
    const candidate = `${base}_${counter}${ext}`;
    target = path.join(dirPath, candidate);
    counter++;
  }
  return `${base}_${counter - 1}${ext}`;
}

/**
 * Sanitize a folder path: only allow a-z 0-9 - _ /
 * Reject path traversal patterns.
 */
function sanitizeFolder(folder) {
  if (!folder) return "";
  // Reject obvious traversal
  if (
    folder.includes("..") ||
    folder.includes("~") ||
    /[\x00\\]/.test(folder)
  ) {
    throw new Error("Invalid folder path");
  }
  // Clean: only allow safe characters
  let clean = folder
    .replace(/[^a-zA-Z0-9\-_/]/g, "-")
    .replace(/-+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
  // Double-check resolved path stays inside STORAGE_ROOT
  const resolved = path.resolve(STORAGE_ROOT, clean);
  if (!resolved.startsWith(STORAGE_ROOT)) {
    throw new Error("Invalid folder path");
  }
  return clean;
}

/**
 * Verify file content matches expected type by checking magic bytes.
 */
function verifyMagicBytes(buffer, mimeType) {
  // For AVIF, accept any buffer (complex ISOBMFF container)
  if (mimeType === "image/avif") return true;

  const sigs = IMAGE_SIGNATURES[mimeType] || DOC_SIGNATURES[mimeType];
  if (!sigs || sigs.length === 0) return true; // no signature to check

  // For WebP, check RIFF at offset 0 AND WEBP at offset 8
  if (mimeType === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).equals(Buffer.from("RIFF")) &&
      buffer.subarray(8, 12).equals(Buffer.from("WEBP"))
    );
  }

  // Check if any signature matches at offset 0
  return sigs.some(
    (sig) => buffer.length >= sig.length && buffer.subarray(0, sig.length).equals(sig)
  );
}

/**
 * Ensure a directory exists, creating recursively if needed.
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize storage: create directories, verify write permissions, log status.
 */
async function initialize() {
  try {
    ensureDir(STORAGE_ROOT);
    ensureDir(path.join(STORAGE_ROOT, "images"));

    // Verify write permission with a temp file
    const testFile = path.join(STORAGE_ROOT, ".write-test");
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);

    logInfo("Storage initialized", { path: STORAGE_ROOT });

    if (sharpAvailable) {
      logInfo("sharp available — image optimization enabled");
    } else {
      logError(
        "sharp not available — images will be stored without optimization. " +
          "Install sharp for automatic image compression/resizing."
      );
    }
  } catch (err) {
    logError("Storage initialization failed", {
      error: err.message,
      path: STORAGE_ROOT,
    });
    throw err;
  }
}

/**
 * Save and optimize an image.
 *
 * @param {Buffer} buffer - Raw image data
 * @param {Object} opts
 * @param {string} opts.folder - Route-aware folder (e.g. "schools/SOICT/clubs")
 * @param {string} opts.originalName - Original filename from user
 * @returns {Object} { url, relativePath, originalName, storedName, width, height, size, originalSize, mimeType }
 */
async function saveImage(buffer, { folder = "", originalName = "image", customName = "" } = {}) {
  const cleanFolder = sanitizeFolder(folder);
  const originalSize = buffer.length;

  // With sharp
  if (sharpAvailable) {
    try {
      const meta = await sharp(buffer).metadata();
      const hasAlpha = meta.hasAlpha || false;

      // Determine resize dimensions
      let targetW = meta.width;
      let targetH = meta.height;
      const maxW = env.uploadImageMaxWidth;
      const maxH = env.uploadImageMaxHeight;

      if (targetW > maxW || targetH > maxH) {
        // Proportional resize: fit inside maxW x maxH
        const ratioW = maxW / targetW;
        const ratioH = maxH / targetH;
        const ratio = Math.min(ratioW, ratioH);
        targetW = Math.round(targetW * ratio);
        targetH = Math.round(targetH * ratio);
      }

      // Determine quality — protect small/already-optimized images
      let quality = env.uploadImageQuality;
      if (originalSize < 200 * 1024) {
        quality = Math.max(quality, 90); // small images get higher quality
      }
      // Never go below 70
      quality = Math.max(quality, 70);

      // Process
      const processed = await sharp(buffer)
        .resize({
          width: targetW,
          height: targetH,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({
          quality,
          effort: 4,
          ...(hasAlpha ? { alphaQuality: 90 } : {}),
        })
        .toBuffer({ resolveWithObject: true });

      const outputBuffer = processed.data;
      const info = processed.info;

      // If output is somehow larger than input (rare), try keeping as-is
      let finalBuffer = outputBuffer;
      let finalExt = "webp";
      let finalMime = "image/webp";

      if (outputBuffer.length > originalSize && originalSize < 500 * 1024) {
        // Keep original if it's smaller and already small
        finalBuffer = buffer;
        finalExt = meta.format || "webp";
        finalMime = `image/${finalExt === "jpg" ? "jpeg" : finalExt}`;
      }

      // Generate filename and path
      const rawName = generateFilename(originalName, finalExt, customName);
      const dirPath = cleanFolder
        ? path.join(STORAGE_ROOT, "images", cleanFolder)
        : path.join(STORAGE_ROOT, "images");
      ensureDir(dirPath);
      const storedName = uniqueFilename(dirPath, rawName);

      const fullPath = path.join(dirPath, storedName);
      fs.writeFileSync(fullPath, finalBuffer);

      // Optionally keep original
      if (env.uploadKeepOriginals) {
        const origDir = path.join(dirPath, "_originals");
        ensureDir(origDir);
        const origExt = meta.format || path.extname(originalName).replace(".", "") || "jpg";
        const origName = generateFilename(originalName, origExt);
        fs.writeFileSync(path.join(origDir, origName), buffer);
      }

      const relativePath = cleanFolder
        ? `images/${cleanFolder}/${storedName}`
        : `images/${storedName}`;

      return {
        url: `${env.uploadBaseUrl}/${relativePath}`,
        relativePath,
        originalName,
        storedName,
        width: info.width,
        height: info.height,
        size: finalBuffer.length,
        originalSize,
        mimeType: finalMime,
      };
    } catch (err) {
      logError("sharp processing failed, storing as-is", {
        error: err.message,
      });
      // Fall through to no-sharp path
    }
  }

  // Without sharp (fallback)
  const ext = path.extname(originalName).replace(".", "") || "jpg";
  const rawName = generateFilename(originalName, ext, customName);
  const dirPath = cleanFolder
    ? path.join(STORAGE_ROOT, "images", cleanFolder)
    : path.join(STORAGE_ROOT, "images");
  ensureDir(dirPath);
  const storedName = uniqueFilename(dirPath, rawName);

  const fullPath = path.join(dirPath, storedName);
  fs.writeFileSync(fullPath, buffer);

  const relativePath = cleanFolder
    ? `images/${cleanFolder}/${storedName}`
    : `images/${storedName}`;

  return {
    url: `${env.uploadBaseUrl}/${relativePath}`,
    relativePath,
    originalName,
    storedName,
    width: null,
    height: null,
    size: buffer.length,
    originalSize: buffer.length,
    mimeType: `image/${ext === "jpg" ? "jpeg" : ext}`,
  };
}

/**
 * Save a file (PDF, DOC, etc.) without processing.
 *
 * @param {Buffer} buffer - Raw file data
 * @param {Object} opts
 * @param {string} opts.folder - Route-aware folder (e.g. "announcements/notices")
 * @param {string} opts.originalName - Original filename
 * @param {string} opts.mimeType - MIME type
 * @returns {Object} { url, relativePath, originalName, storedName, size, mimeType }
 */
function saveFile(buffer, { folder = "", originalName = "file", mimeType = "application/octet-stream", customName = "" } = {}) {
  // Verify magic bytes
  if (!verifyMagicBytes(buffer, mimeType)) {
    throw new Error(
      "File content does not match its declared type. The file may be corrupted or mislabeled."
    );
  }

  const cleanFolder = sanitizeFolder(folder);
  const ext = path.extname(originalName).replace(".", "") || "bin";
  const rawName = generateFilename(originalName, ext, customName);

  const dirPath = cleanFolder
    ? path.join(STORAGE_ROOT, cleanFolder)
    : STORAGE_ROOT;
  ensureDir(dirPath);
  const storedName = uniqueFilename(dirPath, rawName);

  const fullPath = path.join(dirPath, storedName);
  fs.writeFileSync(fullPath, buffer);

  const relativePath = cleanFolder
    ? `${cleanFolder}/${storedName}`
    : storedName;

  return {
    url: `${env.uploadBaseUrl}/${relativePath}`,
    relativePath,
    originalName,
    storedName,
    size: buffer.length,
    mimeType,
  };
}

/**
 * Delete a file by its relative path.
 */
function deleteFile(relativePath) {
  if (!relativePath) throw new Error("No file path provided");

  // Sanitize
  if (relativePath.includes("..") || /[\x00\\]/.test(relativePath)) {
    throw new Error("Invalid file path");
  }

  const fullPath = path.resolve(STORAGE_ROOT, relativePath);
  if (!fullPath.startsWith(STORAGE_ROOT)) {
    throw new Error("Invalid file path");
  }

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    return true;
  }
  return false;
}

/**
 * Resolve a relative path to a public URL.
 */
function resolveUrl(relativePath) {
  if (!relativePath) return "";
  return `${env.uploadBaseUrl}/${relativePath}`;
}

/**
 * Check if a file exists.
 */
function fileExists(relativePath) {
  if (!relativePath) return false;
  const fullPath = path.resolve(STORAGE_ROOT, relativePath);
  if (!fullPath.startsWith(STORAGE_ROOT)) return false;
  return fs.existsSync(fullPath);
}

/**
 * Whether sharp is loaded and available.
 */
function isSharpAvailable() {
  return sharpAvailable;
}

module.exports = {
  initialize,
  saveImage,
  saveFile,
  deleteFile,
  resolveUrl,
  fileExists,
  isSharpAvailable,
  STORAGE_ROOT,
};
