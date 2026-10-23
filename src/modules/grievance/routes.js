const express = require('express');
const controller = require('./controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { checkModuleActive, grievanceUpload } = require('./middleware');
const { errorResponse } = require('../../utils/response');
const ROLES = require('../../constants/roles');

const router = express.Router();

// Mounted at /api/v1/grievances/maintenance

const STAFF_ROLES = [ROLES.JE, ROLES.VENDOR, ROLES.SENIOR_OFFICER, ROLES.DIRECTOR];

// multer errors (bad type, too large) as a 400 instead of a 500.
const upload = (req, res, next) =>
    grievanceUpload(req, res, (error) => {
        if (!error) return next();
        const message = error.code === 'LIMIT_FILE_SIZE' ? 'Attachment must be 8 MB or smaller.' : error.message;
        return errorResponse(res, message, [], 400);
    });

router.use(authenticate);

// Form options (location categories, locations, issue types, stage labels)
router.get('/meta', authorize(ROLES.FACULTY, ROLES.SUPER_ADMIN, ...STAFF_ROLES), controller.getMeta);
router.get('/module-status', authorize(ROLES.FACULTY, ROLES.SUPER_ADMIN, ...STAFF_ROLES), controller.getModuleStatus);

// Faculty: raise and track complaints
router.post('/tickets', authorize(ROLES.FACULTY), checkModuleActive, upload, controller.submitTicket);
router.get('/tickets/mine', authorize(ROLES.FACULTY), controller.getMyTickets);

// Role-scoped lists and dashboards (JE inbox, vendor tasks, escalations, director / VC / HOD overview).
// The service decides what each role can see; faculty without a VC/HOD grievance role get a 403 there.
const VIEWER_ROLES = [ROLES.SUPER_ADMIN, ROLES.FACULTY, ...STAFF_ROLES];
router.get('/tickets', authorize(VIEWER_ROLES), controller.listTickets);
router.get('/stats', authorize(VIEWER_ROLES), controller.getStats);
router.get('/tickets/:ticketId', authorize(VIEWER_ROLES), controller.getTicket);
router.get('/tickets/:ticketId/files/:fileId', authorize(VIEWER_ROLES), controller.downloadAttachment);

// Workflow step (assign_vendor, submit_inspection, approve_timeline, escalate, ...). Optional photo/PDF as `attachment`.
router.post('/tickets/:ticketId/actions/:action', authorize(ROLES.SUPER_ADMIN, ...STAFF_ROLES), upload, controller.performAction);

router.get('/vendors', authorize(ROLES.JE, ROLES.SENIOR_OFFICER, ROLES.SUPER_ADMIN), controller.listVendors);
router.get('/me', authorize(STAFF_ROLES), controller.getMe);

router.get('/notifications', authorize(VIEWER_ROLES), controller.getNotifications);
router.post('/notifications/read', authorize(VIEWER_ROLES), controller.markNotificationsRead);

// Super admin configuration
const adminOnly = authorize(ROLES.SUPER_ADMIN);
router.get('/admin/config', adminOnly, controller.getAdminConfig);
router.put('/admin/module', adminOnly, controller.setModuleEnabled);
router.put('/admin/categories/:categoryKey', adminOnly, controller.setCategoryActive);
router.post('/admin/locations', adminOnly, controller.createLocation);
router.put('/admin/locations/:id', adminOnly, controller.updateLocation);
router.put('/admin/routing-rules/:id', adminOnly, controller.updateRoutingRule);
router.post('/admin/holidays', adminOnly, controller.addHoliday);
router.delete('/admin/holidays/:date', adminOnly, controller.removeHoliday);

module.exports = router;
