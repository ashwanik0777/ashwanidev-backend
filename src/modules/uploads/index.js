const express = require("express");
const multer = require("multer");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { successResponse, errorResponse } = require("../../utils/response");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");
const storage = require("../../services/storage");
const env = require("../../config/env");
const { query } = require("../../config/db");

const router = express.Router();

/**
 * Resolve a relative upload path to an absolute public URL.
 * Uses UPLOAD_PUBLIC_URL if set, otherwise constructs from request.
 */
function resolvePublicUrl(relativePath, req) {
  // If UPLOAD_PUBLIC_URL is configured, use it
  if (env.uploadPublicUrl) {
    return `${env.uploadPublicUrl.replace(/\/$/, '')}/${relativePath}`;
  }
  // Fallback: construct from request
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}${env.uploadBaseUrl}/${relativePath}`;
}

/**
 * Extract storage-relative path from a URL.
 * e.g. "http://localhost:3000/uploads/images/events/file.webp" → "images/events/file.webp"
 */
function extractRelativePath(url) {
  if (!url) return null;
  // Try to extract path after /uploads/
  const marker = '/uploads/';
  const idx = url.indexOf(marker);
  if (idx !== -1) return url.substring(idx + marker.length);
  // If it's already a relative path
  if (!url.startsWith('http') && !url.startsWith('/')) return url;
  return null;
}

// ---------------------------------------------------------------------------
// Multer: IMAGE uploads — ONLY image/* MIME types
// ---------------------------------------------------------------------------
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) =>
      cb(null, `img-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: env.uploadMaxImageSize },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed (JPG, PNG, WebP)"), false);
    }
  },
});

// ---------------------------------------------------------------------------
// Multer: FILE/document uploads — ONLY allowed document MIME types
// ---------------------------------------------------------------------------
const ALLOWED_DOC_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

const fileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) =>
      cb(null, `doc-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: env.uploadMaxFileSize },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOC_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error("Only document files are allowed (PDF, DOC, DOCX, XLS, XLSX)"),
        false
      );
    }
  },
});

// ---------------------------------------------------------------------------
// Helper: clean up temp file after processing
// ---------------------------------------------------------------------------
function cleanupTemp(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* ignore cleanup errors */
  }
}

// ---------------------------------------------------------------------------
// Helper: save upload metadata to DB (best-effort, non-blocking)
// ---------------------------------------------------------------------------
async function saveMetadata(result, uploaderId, fileCategory, folder) {
  try {
    await query(
      `INSERT INTO uploads
        (original_name, stored_name, relative_path, mime_type, file_size, original_size, width, height, file_category, storage_provider, folder, uploader_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (relative_path) DO NOTHING`,
      [
        result.originalName,
        result.storedName,
        result.relativePath,
        result.mimeType,
        result.size,
        result.originalSize || result.size,
        result.width || null,
        result.height || null,
        fileCategory,
        "local",
        folder || null,
        uploaderId || null,
      ]
    );
  } catch (err) {
    // DB logging failure should not break the upload
    console.error("Failed to save upload metadata:", err.message);
  }
}

// ---------------------------------------------------------------------------
// GET /upload/status — check storage readiness
// ---------------------------------------------------------------------------
router.get("/upload/status", (_req, res) => {
  return successResponse(res, "Storage status", {
    configured: true,
    provider: "local",
    sharpAvailable: storage.isSharpAvailable(),
  });
});

// ---------------------------------------------------------------------------
// POST /upload/image — upload + optimize a single image
// ---------------------------------------------------------------------------
router.post(
  "/upload/image",
  authenticate,
  authorize(
    ROLES.SUPER_ADMIN,
    ROLES.SCHOOL,
    ROLES.FACULTY,
    ROLES.STAFF,
    ROLES.STUDENT
  ),
  (req, res, next) => {
    imageUpload.single("image")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return errorResponse(
              res,
              `Image size exceeds the ${Math.round(env.uploadMaxImageSize / (1024 * 1024))}MB limit`,
              [],
              413
            );
          }
          return errorResponse(res, err.message, [], 400);
        }
        return errorResponse(res, err.message, [], 400);
      }
      next();
    });
  },
  async (req, res) => {
    let tempPath = null;
    try {
      if (!req.file) {
        return errorResponse(res, "No image file provided", [], 400);
      }

      tempPath = req.file.path;
      const buffer = fs.readFileSync(tempPath);
      const folder = req.query.folder || "";
      const customName = req.query.name || "";
      const replaceUrl = req.query.replace || "";

      // Auto-delete old file when replacing
      if (replaceUrl) {
        try {
          const oldPath = extractRelativePath(replaceUrl);
          if (oldPath) await storage.deleteFile(oldPath);
        } catch (_) { /* ignore delete errors */ }
      }

      const result = await storage.saveImage(buffer, {
        folder,
        originalName: req.file.originalname,
        customName,
      });

      // Clean up temp
      cleanupTemp(tempPath);

      // Save metadata (non-blocking)
      saveMetadata(result, req.user?.id, "image", folder);

      return successResponse(
        res,
        "Image uploaded successfully",
        {
          url: resolvePublicUrl(result.relativePath, req),
          public_id: result.relativePath,
          width: result.width,
          height: result.height,
          size: result.size,
          originalSize: result.originalSize,
        },
        201
      );
    } catch (error) {
      cleanupTemp(tempPath);
      console.error("Image upload failed:", error);
      return errorResponse(
        res,
        "Image upload failed",
        [{ field: "image", message: error.message }],
        500
      );
    }
  }
);

// ---------------------------------------------------------------------------
// POST /upload/file — upload a document (PDF, DOC, DOCX, XLS, XLSX)
// ---------------------------------------------------------------------------
router.post(
  "/upload/file",
  authenticate,
  authorize(
    ROLES.SUPER_ADMIN,
    ROLES.SCHOOL,
    ROLES.FACULTY,
    ROLES.STAFF,
    ROLES.STUDENT
  ),
  (req, res, next) => {
    fileUpload.single("file")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return errorResponse(
              res,
              `File size exceeds the ${Math.round(env.uploadMaxFileSize / (1024 * 1024))}MB limit`,
              [],
              413
            );
          }
          return errorResponse(res, err.message, [], 400);
        }
        return errorResponse(res, err.message, [], 400);
      }
      next();
    });
  },
  async (req, res) => {
    let tempPath = null;
    try {
      if (!req.file) {
        return errorResponse(res, "No file provided", [], 400);
      }

      tempPath = req.file.path;
      const buffer = fs.readFileSync(tempPath);
      const folder = req.query.folder || "";
      const customName = req.query.name || "";
      const replaceUrl = req.query.replace || "";

      // Auto-delete old file when replacing
      if (replaceUrl) {
        try {
          const oldPath = extractRelativePath(replaceUrl);
          if (oldPath) storage.deleteFile(oldPath);
        } catch (_) { /* ignore delete errors */ }
      }

      const result = storage.saveFile(buffer, {
        folder,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        customName,
      });

      // Clean up temp
      cleanupTemp(tempPath);

      // Save metadata (non-blocking)
      saveMetadata(result, req.user?.id, "document", folder);

      return successResponse(
        res,
        "File uploaded successfully",
        {
          url: resolvePublicUrl(result.relativePath, req),
          public_id: result.relativePath,
          originalName: result.originalName,
          size: result.size,
        },
        201
      );
    } catch (error) {
      cleanupTemp(tempPath);
      console.error("File upload failed:", error);
      return errorResponse(
        res,
        "File upload failed",
        [{ field: "file", message: error.message }],
        500
      );
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /upload/file — delete a previously uploaded file
// ---------------------------------------------------------------------------
router.delete(
  "/upload/file",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      const { relativePath } = req.body;
      if (!relativePath) {
        return errorResponse(res, "relativePath is required", [], 400);
      }

      const deleted = storage.deleteFile(relativePath);

      // Remove metadata from DB
      try {
        await query("DELETE FROM uploads WHERE relative_path = $1", [
          relativePath,
        ]);
      } catch {
        /* ignore */
      }

      return successResponse(res, deleted ? "File deleted" : "File not found", {
        deleted,
      });
    } catch (error) {
      console.error("File delete failed:", error);
      return errorResponse(res, error.message, [], 500);
    }
  }
);

module.exports = router;
