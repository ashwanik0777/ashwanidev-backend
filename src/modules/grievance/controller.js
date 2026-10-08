const service = require('./service');
const { validateCreateGrievance, validateUpdateStatus } = require('./validators');
const { successResponse, errorResponse } = require('../../utils/response');
const path = require('path');
const fs = require('fs');
const model = require('./model');

async function createGrievance(req, res) {
    try {
        const errors = validateCreateGrievance(req.body, req.user.role);
        if (errors.length > 0) {
            return errorResponse(res, 'Validation failed', errors, 400);
        }

        const record = await service.submitGrievance(req.user, req.body, req.file);
        return successResponse(res, 'Grievance submitted successfully', { ticket_id: record.ticket_id }, 201);
    } catch (error) {
        return errorResponse(res, error.message || 'Internal server error', null, 500);
    }
}

async function getMyGrievances(req, res) {
    try {
        const records = await service.getMyGrievances(req.user);
        return successResponse(res, 'Grievances retrieved successfully', records, 200);
    } catch (error) {
        return errorResponse(res, 'Failed to fetch grievances', null, 500);
    }
}

async function getMyGrievanceDetail(req, res) {
    try {
        const record = await service.getMyGrievanceDetail(req.user, req.params.ticketId);
        return successResponse(res, 'Grievance detail retrieved successfully', record, 200);
    } catch (error) {
        return errorResponse(res, error.message || 'Error fetching detail', null, 404);
    }
}

async function getCategories(req, res) {
    try {
        const type = req.user.role === 'student' ? 'student' : 'faculty';
        const categories = service.getCategories(type);
        return successResponse(res, 'Categories retrieved successfully', categories, 200);
    } catch (error) {
        return errorResponse(res, 'Error fetching categories', null, 500);
    }
}

async function getModuleStatus(req, res) {
    try {
        const moduleEnabled = await service.getSetting('module_enabled');
        const studentEnabled = await service.getSetting('student_module_enabled');
        return successResponse(res, 'Status retrieved', { 
            module_enabled: moduleEnabled === 'true',
            student_module_enabled: studentEnabled === 'true'
        }, 200);
    } catch (error) {
        return errorResponse(res, 'Error fetching status', null, 500);
    }
}

async function getManagedGrievances(req, res) {
    try {
        const { page = 1, limit = 10, status, category, search, submitterType, school } = req.query;
        const result = await service.getGrievancesForManagement(req.user, { page, limit, status, category, search, submitterType, school });
        return successResponse(res, 'Managed grievances retrieved', result.data, 200, {
            total: result.total,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        return errorResponse(res, error.message || 'Error fetching managed grievances', null, 500);
    }
}

async function getManagedGrievanceDetail(req, res) {
    try {
        // Simple security: check if it falls under scope
        const scope = service.getGrievanceScope(req.user);
        if (!scope) return errorResponse(res, 'Unauthorized', null, 403);
        
        const record = await model.getGrievanceDetail(req.params.ticketId);
        if (!record) return errorResponse(res, 'Not found', null, 404);

        return successResponse(res, 'Detail retrieved', record, 200);
    } catch (error) {
        return errorResponse(res, 'Error fetching detail', null, 500);
    }
}

async function updateGrievanceStatus(req, res) {
    try {
        const errors = validateUpdateStatus(req.body);
        if (errors.length > 0) return errorResponse(res, 'Validation failed', errors, 400);

        const updated = await service.updateGrievance(req.user, req.params.ticketId, req.body.status, req.body.admin_remark, req);
        return successResponse(res, 'Status updated successfully', updated, 200);
    } catch (error) {
        return errorResponse(res, error.message || 'Error updating status', null, 500);
    }
}

async function getManagementStats(req, res) {
    try {
        const stats = await service.getStatsForManagement(req.user);
        return successResponse(res, 'Stats retrieved', stats, 200);
    } catch (error) {
        return errorResponse(res, 'Error fetching stats', null, 500);
    }
}

async function exportGrievances(req, res) {
    try {
        const scope = service.getGrievanceScope(req.user);
        const data = await model.exportGrievances(scope);
        
        if (!data || data.length === 0) {
            return errorResponse(res, 'No data to export', null, 404);
        }

        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(row => Object.values(row).map(val => `"${val || ''}"`).join(',')).join('\\n');
        const csv = `${headers}\\n${rows}`;

        res.header('Content-Type', 'text/csv');
        res.attachment('grievances_export.csv');
        return res.send(csv);
    } catch (error) {
        return errorResponse(res, 'Error exporting data', null, 500);
    }
}

async function getSettings(req, res) {
    try {
        const moduleEnabled = await service.getSetting('module_enabled');
        const studentEnabled = await service.getSetting('student_module_enabled');
        return successResponse(res, 'Settings retrieved', {
            module_enabled: moduleEnabled === 'true',
            student_module_enabled: studentEnabled === 'true'
        }, 200);
    } catch (error) {
        return errorResponse(res, 'Error fetching settings', null, 500);
    }
}

async function toggleModule(req, res) {
    try {
        const current = await service.getSetting('module_enabled');
        const newValue = current === 'true' ? 'false' : 'true';
        await service.updateSetting('module_enabled', newValue, req.user.sub);
        return successResponse(res, 'Module setting updated', { module_enabled: newValue === 'true' }, 200);
    } catch (error) {
        return errorResponse(res, 'Error updating module setting', null, 500);
    }
}

async function toggleStudentModule(req, res) {
    try {
        const current = await service.getSetting('student_module_enabled');
        const newValue = current === 'true' ? 'false' : 'true';
        await service.updateSetting('student_module_enabled', newValue, req.user.sub);
        return successResponse(res, 'Student module setting updated', { student_module_enabled: newValue === 'true' }, 200);
    } catch (error) {
        return errorResponse(res, 'Error updating student module setting', null, 500);
    }
}

async function getAttachment(req, res) {
    try {
        // Support auth via Bearer header OR ?token= query param (for browser img/a tags)
        const jwt = require('jsonwebtoken');
        const env = require('../../config/env');
        let token = null;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        } else if (req.query.token) {
            token = req.query.token;
        }
        if (!token) {
            return errorResponse(res, 'Authentication required', null, 401);
        }
        let user;
        try {
            user = jwt.verify(token, env.jwtAccessSecret);
        } catch (e) {
            return errorResponse(res, 'Invalid or expired token', null, 401);
        }

        const record = await model.getGrievanceDetail(req.params.ticketId);
        if (!record || !record.attachment_url) {
            return errorResponse(res, 'Attachment not found', null, 404);
        }

        // Security check: only submitter or management roles can view
        if (String(record.submitter_id) !== String(user.sub)) {
            const scope = service.getGrievanceScope(user);
            if (!scope) return errorResponse(res, 'Unauthorized to view this attachment', null, 403);
        }

        const fileName = path.basename(record.attachment_url);
        const filePath = path.join(process.cwd(), 'storage', 'uploads', 'grievances', fileName);

        if (!fs.existsSync(filePath)) {
            return errorResponse(res, 'File not found on server', null, 404);
        }

        return res.sendFile(filePath);
    } catch (error) {
        return errorResponse(res, 'Error downloading attachment', null, 500);
    }
}

module.exports = {
    createGrievance, getMyGrievances, getMyGrievanceDetail, getCategories,
    getModuleStatus, getManagedGrievances, getManagedGrievanceDetail,
    updateGrievanceStatus, getManagementStats, exportGrievances,
    getSettings, toggleModule, toggleStudentModule, getAttachment
};
