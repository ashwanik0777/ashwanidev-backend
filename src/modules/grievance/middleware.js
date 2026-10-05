const multer = require('multer');
const os = require('os');
const ROLES = require('../../constants/roles');
const service = require('./service');
const { errorResponse } = require('../../utils/response');

function requireGrievanceManagement(req, res, next) {
    const user = req.user;
    if (user.role === ROLES.SUPER_ADMIN) {
        return next();
    }
    
    if (user.role === ROLES.FACULTY && ['vc', 'dean', 'hod'].includes(user.grievanceRole)) {
        return next();
    }

    return errorResponse(res, 'Forbidden: Management access required', null, 403);
}

function requireGrievanceUpdate(req, res, next) {
    requireGrievanceManagement(req, res, () => {
        const scope = service.getGrievanceScope(req.user);
        if (!scope || !scope.canUpdate) {
            return errorResponse(res, 'Vice Chancellor access is read-only', null, 403);
        }
        next();
    });
}

async function checkModuleActive(req, res, next) {
    try {
        const isActive = await service.getSetting('module_enabled');
        if (isActive !== 'true') {
            return errorResponse(res, 'Grievance module is currently disabled', null, 503);
        }
        next();
    } catch (err) {
        next(err);
    }
}

async function checkStudentModuleActive(req, res, next) {
    try {
        if (req.user.role === ROLES.STUDENT) {
            const isStudentActive = await service.getSetting('student_module_enabled');
            if (isStudentActive !== 'true') {
                return errorResponse(res, 'Student grievance portal is currently disabled', null, 403);
            }
        }
        next();
    } catch (err) {
        next(err);
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, os.tmpdir());
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Invalid file type. Only JPG, PNG, WEBP, and PDF are allowed.'));
    }
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 8 * 1024 * 1024 }, // 8MB limit
    fileFilter: fileFilter
});

const grievanceUpload = upload.single('attachment');

module.exports = {
    requireGrievanceManagement,
    requireGrievanceUpdate,
    checkModuleActive,
    checkStudentModuleActive,
    grievanceUpload
};
