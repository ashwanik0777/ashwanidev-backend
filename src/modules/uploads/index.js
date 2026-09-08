const express = require("express");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { successResponse, errorResponse } = require("../../utils/response");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");

const router = express.Router();

// ---------------------------------------------------------------------------
// Multer setup – memory storage, max 10MB, images only
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"), false);
    }
  },
});

// ---------------------------------------------------------------------------
// Cloudinary configuration helpers
// ---------------------------------------------------------------------------
const isCloudinaryConfigured = () => {
  return !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );
};

if (isCloudinaryConfigured()) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// ---------------------------------------------------------------------------
// GET /upload/status – check if Cloudinary is configured (no auth)
// ---------------------------------------------------------------------------
router.get("/upload/status", (_req, res) => {
  return successResponse(res, "Cloudinary configuration status", {
    configured: isCloudinaryConfigured(),
  });
});

// ---------------------------------------------------------------------------
// POST /upload/image – upload a single image to Cloudinary
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
  upload.single("image"),
  async (req, res) => {
    try {
      // Guard: Cloudinary must be configured
      if (!isCloudinaryConfigured()) {
        return errorResponse(
          res,
          "Cloud storage is not configured. Please add Cloudinary credentials to .env",
          [],
          503
        );
      }

      // Guard: file must be present
      if (!req.file) {
        return errorResponse(res, "No image file provided", [], 400);
      }

      const folder = req.query.folder || "gbu-website/general";

      // Upload via stream
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder,
            resource_type: "image",
            format: "webp",
            quality: "auto:good",
          },
          (error, uploadResult) => {
            if (error) return reject(error);
            return resolve(uploadResult);
          }
        );

        uploadStream.end(req.file.buffer);
      });

      return successResponse(
        res,
        "Image uploaded successfully",
        {
          url: result.secure_url,
          public_id: result.public_id,
        },
        201
      );
    } catch (error) {
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

module.exports = router;
