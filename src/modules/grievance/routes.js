const express = require('express');
const router = express.Router();
const controller = require('./controller');
const { authenticate, authorize } = require('../../middleware/auth');
const { 
    requireGrievanceManagement, 
    requireGrievanceUpdate, 
    checkModuleActive, 
    checkStudentModuleActive, 
    grievanceUpload 
} = require('./middleware');
const ROLES = require('../../constants/roles');

// Rate limiting comment: Handled at app level

// Public
router.get('/module-status', controller.getModuleStatus);

// User endpoints
router.post(
    '/', 
    authenticate, 
    authorize(ROLES.STUDENT, ROLES.FACULTY), 
    checkModuleActive, 
    checkStudentModuleActive, 
    grievanceUpload, 
    controller.createGrievance
);
router.get('/my', authenticate, authorize(ROLES.STUDENT, ROLES.FACULTY), controller.getMyGrievances);
router.get('/my/:ticketId', authenticate, authorize(ROLES.STUDENT, ROLES.FACULTY), controller.getMyGrievanceDetail);
router.get('/categories', authenticate, authorize(ROLES.STUDENT, ROLES.FACULTY), controller.getCategories);

// Management endpoints
router.get('/manage', authenticate, requireGrievanceManagement, controller.getManagedGrievances);
router.get('/manage/stats', authenticate, requireGrievanceManagement, controller.getManagementStats);
router.get('/manage/export', authenticate, authorize(ROLES.SUPER_ADMIN), controller.exportGrievances);
router.get('/manage/:ticketId', authenticate, requireGrievanceManagement, controller.getManagedGrievanceDetail);
router.put('/manage/:ticketId/status', authenticate, requireGrievanceUpdate, controller.updateGrievanceStatus);

// Settings endpoints
router.get('/settings', authenticate, authorize(ROLES.SUPER_ADMIN), controller.getSettings);
router.put('/settings/toggle-module', authenticate, authorize(ROLES.SUPER_ADMIN), controller.toggleModule);
router.put('/settings/toggle-student', authenticate, authorize(ROLES.SUPER_ADMIN), controller.toggleStudentModule);

// Attachment download — supports both Bearer header and ?token= query param for browser img/a tags
router.get('/attachment/:ticketId', controller.getAttachment);

module.exports = router;
