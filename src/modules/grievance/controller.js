const service = require('./service');
const { GrievanceError } = require('./errors');
const { successResponse, errorResponse } = require('../../utils/response');
const { logError } = require('../../config/logger');

// Wraps a handler so expected GrievanceErrors map to their status and anything else is a generic 500.
const handle = (fn) => async (req, res) => {
    try {
        return await fn(req, res);
    } catch (error) {
        if (error instanceof GrievanceError) {
            return errorResponse(res, error.message, [], error.status);
        }
        logError('Maintenance grievance request failed', {
            requestId: req.requestId,
            path: req.originalUrl,
            error: error.message,
            stack: error.stack,
        });
        return errorResponse(res, 'Something went wrong. Please try again.', [], 500);
    }
};

module.exports = {
    getMeta: handle(async (req, res) => successResponse(res, 'Maintenance form options', await service.getMeta())),

    submitTicket: handle(async (req, res) => {
        const result = await service.submitTicket(req.user, req.body || {}, req.file);
        return successResponse(res, 'Grievance submitted successfully', result, 201);
    }),

    getMyTickets: handle(async (req, res) => successResponse(res, 'Your maintenance grievances', await service.getMyTickets(req.user))),

    listTickets: handle(async (req, res) => {
        const { items, pagination } = await service.listTickets(req.user, req.query);
        return successResponse(res, 'Maintenance grievances', items, 200, pagination);
    }),

    getStats: handle(async (req, res) => successResponse(res, 'Maintenance grievance stats', await service.getStats(req.user, req.query))),

    getTicket: handle(async (req, res) => successResponse(res, 'Ticket detail', await service.getTicketDetail(req.user, req.params.ticketId))),

    performAction: handle(async (req, res) => {
        const detail = await service.performAction(req.user, req.params.ticketId, req.params.action, req.body || {}, req.file);
        return successResponse(res, 'Ticket updated', detail);
    }),

    downloadAttachment: handle(async (req, res) => {
        const file = await service.getAttachment(req.user, req.params.ticketId, req.params.fileId);
        res.setHeader('Content-Type', file.mime || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${String(file.name || 'attachment').replace(/[^\w.\- ]/g, '_')}"`);
        res.setHeader('Cache-Control', 'private, no-store');
        return res.sendFile(file.absolutePath);
    }),

    listVendors: handle(async (req, res) => successResponse(res, 'Vendors', await service.listVendors(req.user, req.query.trade))),

    getMe: handle(async (req, res) => successResponse(res, 'Staff profile', await service.getMyStaffProfile(req.user))),

    getNotifications: handle(async (req, res) => successResponse(res, 'Notifications', await service.getNotifications(req.user))),

    markNotificationsRead: handle(async (req, res) => {
        await service.markNotificationsRead(req.user, req.body?.ids);
        return successResponse(res, 'Notifications marked as read', {});
    }),

    getModuleStatus: handle(async (req, res) =>
        successResponse(res, 'Module status', { module_enabled: await service.isModuleEnabled() })),

    setModuleEnabled: handle(async (req, res) =>
        successResponse(res, 'Module setting updated', await service.setModuleEnabled(req.user, req.body?.module_enabled))),

    getAdminConfig: handle(async (req, res) => successResponse(res, 'Maintenance configuration', await service.getAdminConfig())),

    setCategoryActive: handle(async (req, res) =>
        successResponse(res, 'Category updated', await service.setCategoryActive(req.params.categoryKey, req.body?.is_active))),

    createLocation: handle(async (req, res) => successResponse(res, 'Location added', await service.createLocation(req.body || {}), 201)),

    updateLocation: handle(async (req, res) => successResponse(res, 'Location updated', await service.updateLocation(req.params.id, req.body || {}))),

    updateRoutingRule: handle(async (req, res) =>
        successResponse(res, 'Routing rule updated', await service.updateRoutingRule(req.user, req.params.id, req.body || {}))),

    addHoliday: handle(async (req, res) => successResponse(res, 'Holiday saved', await service.addHoliday(req.body || {}), 201)),

    removeHoliday: handle(async (req, res) => {
        await service.removeHoliday(req.params.date);
        return successResponse(res, 'Holiday removed', {});
    }),
};
