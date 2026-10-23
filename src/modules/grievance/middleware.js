const multer = require('multer');
const os = require('os');
const service = require('./service');
const { errorResponse } = require('../../utils/response');

// Blocks new complaints while the super admin has the module switched off.
async function checkModuleActive(req, res, next) {
    try {
        if (!(await service.isModuleEnabled())) {
            return errorResponse(res, 'Grievance module is currently disabled', [], 503);
        }
        return next();
    } catch (error) {
        return next(error);
    }
}

// Files land in the OS temp dir; files.js validates and moves them to private storage.
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, os.tmpdir()),
        filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
    }),
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) return cb(null, true);
        return cb(new Error('Invalid file type. Only JPG, PNG, WEBP, and PDF are allowed.'));
    },
});

const grievanceUpload = upload.single('attachment');

module.exports = { checkModuleActive, grievanceUpload };
