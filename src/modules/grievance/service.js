const crypto = require('crypto');
const ROLES = require('../../constants/roles');
const { query } = require('../../config/db');
const { logError } = require('../../config/logger');
const model = require('./model');
const notifier = require('./notifier');
const files = require('./files');
const { GrievanceError } = require('./errors');
const { addWorkingDaysDeadline, todayIstKey } = require('./workingDays');
const {
    WORKFLOW,
    TICKET_PREFIX,
    FACULTY_CATEGORY,
    SITE_VISIT_WORKING_DAYS,
    DESCRIPTION_MAX_WORDS,
    STAGES,
    STAGE_LABELS,
    ALL_STAGES,
    SEVERITY_LEVELS,
    statusForStage,
} = require('./constants');

const SYSTEM_ACTOR = { actorId: null, actorRole: 'system', actorName: 'System' };

/* ─── Validation helpers ─── */

const cleanText = (value) => (typeof value === 'string' ? value.trim() : '');

const requireText = (value, label, max = 2000) => {
    const text = cleanText(value);
    if (!text) throw new GrievanceError(`${label} is required.`);
    if (text.length > max) throw new GrievanceError(`${label} must be at most ${max} characters.`);
    return text;
};

const optionalText = (value, label, max = 2000) => {
    const text = cleanText(value);
    if (text.length > max) throw new GrievanceError(`${label} must be at most ${max} characters.`);
    return text || null;
};

const requireFutureDate = (value, label) => {
    const text = cleanText(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
        throw new GrievanceError(`${label} must be a valid date (YYYY-MM-DD).`);
    }
    if (text < todayIstKey()) throw new GrievanceError(`${label} cannot be in the past.`);
    return text;
};

const requirePercent = (value) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 100) {
        throw new GrievanceError('Progress must be a whole number between 0 and 100.');
    }
    return number;
};

const requireId = (value, label) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) throw new GrievanceError(`${label} is required.`);
    return number;
};

const wordCount = (text) => text.split(/\s+/).filter(Boolean).length;

const formatIst = (date) =>
    new Date(date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

const actorOf = (user) => ({ actorId: Number(user.sub), actorRole: user.role, actorName: user.name });

async function holidayKeys() {
    const rows = await model.listHolidays({ fromDate: todayIstKey() });
    return new Set(rows.map((row) => row.holiday_date));
}

async function siteVisitDeadline() {
    return addWorkingDaysDeadline(new Date(), SITE_VISIT_WORKING_DAYS, await holidayKeys());
}

async function requireVendorForTrade(vendorId, trade) {
    const vendor = await model.getStaffMember(requireId(vendorId, 'Vendor'), ROLES.VENDOR);
    if (!vendor) throw new GrievanceError('Selected vendor was not found or is inactive.');
    if (trade && vendor.trade && vendor.trade !== trade) {
        throw new GrievanceError(`This is a ${trade} complaint — please choose a ${trade} vendor.`);
    }
    return vendor;
}

/* ─── Who can see what ─── */

// Read scope for list/stats screens. Returns null when the user has no access.
function getViewerScope(user) {
    const me = Number(user.sub);
    switch (user.role) {
        case ROLES.SUPER_ADMIN:
            return { kind: 'admin', where: 'TRUE', params: [] };
        case ROLES.DIRECTOR:
            return { kind: 'director', where: 'TRUE', params: [] };
        case ROLES.JE:
            return { kind: 'je', where: 'g.assigned_je_id = $1', params: [me] };
        case ROLES.VENDOR:
            return { kind: 'vendor', where: 'g.assigned_vendor_id = $1', params: [me] };
        case ROLES.SENIOR_OFFICER:
            return { kind: 'senior_officer', where: 'g.escalated_at IS NOT NULL', params: [] };
        case ROLES.FACULTY:
            if (user.grievanceRole === 'vc') return { kind: 'vc', where: 'TRUE', params: [] };
            if (user.grievanceRole === 'hod' && user.schoolCode && user.departmentName) {
                return {
                    kind: 'hod',
                    where: 'LOWER(g.school_code) = LOWER($1) AND LOWER(g.department_name) = LOWER($2)',
                    params: [user.schoolCode, user.departmentName],
                };
            }
            return null;
        default:
            return null;
    }
}

const sameText = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

// JS twin of getViewerScope's SQL, used for single-ticket access.
function canView(user, ticket) {
    if (user.role === ROLES.FACULTY && String(ticket.submitter_id) === String(user.sub)) return 'owner';
    const scope = getViewerScope(user);
    if (!scope) return null;
    const me = Number(user.sub);
    switch (scope.kind) {
        case 'admin':
        case 'director':
        case 'vc':
            return scope.kind;
        case 'je':
            return ticket.assigned_je_id === me ? 'je' : null;
        case 'vendor':
            return ticket.assigned_vendor_id === me ? 'vendor' : null;
        case 'senior_officer':
            return ticket.escalated_at ? 'senior_officer' : null;
        case 'hod':
            return sameText(ticket.school_code, user.schoolCode) && sameText(ticket.department_name, user.departmentName) ? 'hod' : null;
        default:
            return null;
    }
}

// Vendors visit the site and need the complainant's name, phone and location — not their email or internal paths.
function presentTicket(ticket, viewer) {
    const { attachment_path, ...rest } = ticket;
    const presented = {
        ...rest,
        stage_label: STAGE_LABELS[ticket.stage] || ticket.stage,
        has_attachment: Boolean(attachment_path),
    };
    if (viewer === 'vendor') delete presented.submitter_email;
    return presented;
}

async function loadVisibleTicket(user, ticketId) {
    const ticket = await model.getTicket(String(ticketId || ''));
    const viewer = ticket ? canView(user, ticket) : null;
    if (!viewer) throw new GrievanceError('Ticket not found.', 404);
    return { ticket, viewer };
}

/* ─── Workflow actions ─── */

const JE_ACTIVE_STAGES = [STAGES.ASSIGNED_TO_VENDOR, STAGES.INSPECTION_SUBMITTED, STAGES.WORK_IN_PROGRESS, STAGES.DELAYED];

/*
 * Each action: who may run it, from which stages, and a `plan` that validates
 * the input and returns the target stage, column updates, the timeline entry
 * and who to notify once the move succeeds.
 */
const ACTIONS = {
    assign_vendor: {
        role: ROLES.JE,
        from: [STAGES.PENDING_JE_REVIEW, STAGES.ASSIGNED_TO_VENDOR],
        plan: async (ticket, body) => {
            const vendor = await requireVendorForTrade(body.vendor_id, ticket.trade);
            const isReassign = Boolean(ticket.assigned_vendor_id);
            if (isReassign && ticket.assigned_vendor_id === vendor.id) {
                throw new GrievanceError('This vendor is already assigned to the ticket.');
            }
            const dueAt = await siteVisitDeadline();
            return {
                toStage: STAGES.ASSIGNED_TO_VENDOR,
                event: isReassign ? 'vendor_reassigned' : 'vendor_assigned',
                remarks: optionalText(body.remarks, 'Instructions'),
                details: { vendor_id: vendor.id, vendor_name: vendor.name, site_visit_due_at: dueAt.toISOString() },
                updates: {
                    assigned_vendor_id: vendor.id,
                    assigned_to: vendor.name.slice(0, 100),
                    vendor_assigned_at: new Date(),
                    site_visit_due_at: dueAt,
                    site_visit_at: null,
                    site_visit_overdue_at: null,
                },
                notify: async () => {
                    await notifier.notifyUsers([vendor.id], {
                        ticketId: ticket.ticket_id,
                        title: 'New work assigned to you',
                        message: `Please visit the site and submit your inspection report by ${formatIst(dueAt)}.`,
                        rows: [['Location', `${ticket.location_label} - ${ticket.exact_location}`], ['Issue', ticket.sub_category]],
                    });
                    if (isReassign) {
                        await notifier.notifyUsers([ticket.assigned_vendor_id], {
                            ticketId: ticket.ticket_id,
                            title: 'Assignment withdrawn',
                            message: 'This ticket has been reassigned to another vendor.',
                        });
                    }
                    await notifier.notifySubmitter(ticket, {
                        ticketId: ticket.ticket_id,
                        title: 'Vendor assigned to your complaint',
                        message: `A vendor has been assigned and will visit the location by ${formatIst(dueAt)}.`,
                    });
                },
            };
        },
    },

    follow_up: {
        role: ROLES.JE,
        from: [STAGES.ASSIGNED_TO_VENDOR],
        plan: async (ticket, body) => {
            const remarks = requireText(body.remarks, 'Follow-up remarks');
            const dueAt = await siteVisitDeadline();
            return {
                toStage: STAGES.ASSIGNED_TO_VENDOR,
                event: 'vendor_followed_up',
                remarks,
                details: { site_visit_due_at: dueAt.toISOString() },
                updates: {
                    site_visit_due_at: dueAt,
                    site_visit_overdue_at: null,
                    follow_up_count: (ticket.follow_up_count || 0) + 1,
                },
                notify: () => notifier.notifyUsers([ticket.assigned_vendor_id], {
                    ticketId: ticket.ticket_id,
                    title: 'Follow-up from JE: site visit pending',
                    message: `${remarks} New site-visit deadline: ${formatIst(dueAt)}.`,
                }),
            };
        },
    },

    submit_inspection: {
        role: ROLES.VENDOR,
        from: [STAGES.ASSIGNED_TO_VENDOR],
        allowsAttachment: true,
        plan: async (ticket, body) => {
            const report = requireText(body.inspection_report, 'Inspection report', 3000);
            const visitedAt = new Date();
            const withinDeadline = !ticket.site_visit_due_at || visitedAt <= new Date(ticket.site_visit_due_at);

            // Small jobs are often fixed on the spot during the visit: skip the timeline
            // approval and send the ticket straight to the JE for verification.
            if (body.work_completed === true || body.work_completed === 'true') {
                return {
                    toStage: STAGES.WORK_COMPLETED,
                    event: 'inspection_submitted',
                    remarks: optionalText(body.remarks, 'Remarks'),
                    details: { inspection_report: report, completed_during_inspection: true, visited_within_deadline: withinDeadline },
                    updates: {
                        site_visit_at: visitedAt,
                        inspection_report: report,
                        pending_tasks: null,
                        progress_percent: 100,
                        work_completed_at: visitedAt,
                    },
                    notify: () => notifier.notifyUsers([ticket.assigned_je_id], {
                        ticketId: ticket.ticket_id,
                        title: 'Work completed during inspection',
                        message: 'The vendor fixed the problem during the site visit. Please review and close the ticket (or request rework).',
                    }),
                };
            }

            const estimatedDate = requireFutureDate(body.estimated_completion_date, 'Estimated completion date');
            const pendingTasks = optionalText(body.pending_tasks, 'Pending tasks');
            const progress = body.progress_percent === undefined || body.progress_percent === '' ? 0 : requirePercent(body.progress_percent);
            return {
                toStage: STAGES.INSPECTION_SUBMITTED,
                event: 'inspection_submitted',
                remarks: optionalText(body.remarks, 'Remarks'),
                details: {
                    inspection_report: report,
                    pending_tasks: pendingTasks,
                    estimated_completion_date: estimatedDate,
                    progress_percent: progress,
                    visited_within_deadline: withinDeadline,
                },
                updates: {
                    site_visit_at: visitedAt,
                    inspection_report: report,
                    pending_tasks: pendingTasks,
                    vendor_estimated_date: estimatedDate,
                    progress_percent: progress,
                },
                notify: () => notifier.notifyUsers([ticket.assigned_je_id], {
                    ticketId: ticket.ticket_id,
                    title: 'Vendor submitted inspection report',
                    message: `Estimated completion date: ${estimatedDate}. Please review and approve the timeline.`,
                }),
            };
        },
    },

    approve_timeline: {
        role: ROLES.JE,
        from: [STAGES.INSPECTION_SUBMITTED],
        plan: async (ticket, body) => {
            const approvedDate = requireFutureDate(body.approved_completion_date, 'Approved completion date');
            return {
                toStage: STAGES.WORK_IN_PROGRESS,
                event: 'timeline_approved',
                remarks: optionalText(body.remarks, 'Remarks'),
                details: { approved_completion_date: approvedDate, vendor_estimated_date: ticket.vendor_estimated_date },
                updates: { approved_completion_date: approvedDate },
                notify: async () => {
                    await notifier.notifyUsers([ticket.assigned_vendor_id], {
                        ticketId: ticket.ticket_id,
                        title: 'Timeline approved — start work',
                        message: `Work must be completed by ${approvedDate}.`,
                    });
                    await notifier.notifySubmitter(ticket, {
                        ticketId: ticket.ticket_id,
                        title: 'Work scheduled on your complaint',
                        message: `Expected completion date: ${approvedDate}.`,
                    });
                },
            };
        },
    },

    update_progress: {
        role: ROLES.VENDOR,
        from: [STAGES.WORK_IN_PROGRESS, STAGES.DELAYED],
        allowsAttachment: true,
        plan: async (ticket, body) => {
            const progress = requirePercent(body.progress_percent);
            const remarks = requireText(body.remarks, 'Progress remarks');
            const pendingTasks = optionalText(body.pending_tasks, 'Pending tasks');
            return {
                toStage: ticket.stage,
                event: 'progress_updated',
                remarks,
                details: { progress_percent: progress, pending_tasks: pendingTasks },
                updates: { progress_percent: progress, pending_tasks: pendingTasks },
                notify: () => notifier.notifyUsers([ticket.assigned_je_id], {
                    ticketId: ticket.ticket_id,
                    title: `Vendor progress update (${progress}%)`,
                    message: remarks,
                }),
            };
        },
    },

    mark_completed: {
        role: ROLES.VENDOR,
        from: [STAGES.WORK_IN_PROGRESS, STAGES.DELAYED],
        allowsAttachment: true,
        plan: async (ticket, body) => {
            const remarks = requireText(body.remarks, 'Completion remarks');
            const completedAt = new Date();
            const onTime = !ticket.approved_completion_date || todayIstKey(completedAt) <= ticket.approved_completion_date;
            return {
                toStage: STAGES.WORK_COMPLETED,
                event: 'work_completed',
                remarks,
                details: { completed_on_time: onTime },
                updates: { progress_percent: 100, work_completed_at: completedAt },
                notify: () => notifier.notifyUsers([ticket.assigned_je_id], {
                    ticketId: ticket.ticket_id,
                    title: 'Vendor marked work as completed',
                    message: 'Please verify the completed work.',
                }),
            };
        },
    },

    mark_resolved: {
        role: ROLES.JE,
        from: [STAGES.WORK_COMPLETED],
        plan: async (ticket, body) => {
            const remarks = optionalText(body.remarks, 'Remarks');
            const now = new Date();
            return {
                toStage: STAGES.CLOSED,
                event: 'resolved_and_closed',
                remarks,
                details: {},
                updates: { closed_at: now, resolved_at: now, admin_remark: remarks },
                notify: async () => {
                    await notifier.notifySubmitter(ticket, {
                        ticketId: ticket.ticket_id,
                        title: 'Your complaint has been resolved',
                        message: remarks || 'The work has been verified by the JE and the ticket is now closed.',
                    });
                    await notifier.notifyUsers([ticket.assigned_vendor_id], {
                        ticketId: ticket.ticket_id,
                        title: 'Work verified and ticket closed',
                        message: 'Thank you — the JE has verified your work.',
                    });
                },
            };
        },
    },

    request_rework: {
        role: ROLES.JE,
        from: [STAGES.WORK_COMPLETED],
        allowsAttachment: true,
        plan: async (ticket, body) => {
            const remarks = requireText(body.remarks, 'Rework remarks');
            const newDate = cleanText(body.approved_completion_date)
                ? requireFutureDate(body.approved_completion_date, 'Revised completion date')
                : ticket.approved_completion_date;
            if (!newDate || newDate < todayIstKey()) {
                throw new GrievanceError('Please set a revised completion date for the rework.');
            }
            return {
                toStage: STAGES.WORK_IN_PROGRESS,
                event: 'rework_requested',
                remarks,
                details: { approved_completion_date: newDate },
                updates: {
                    rework_count: (ticket.rework_count || 0) + 1,
                    work_completed_at: null,
                    approved_completion_date: newDate,
                },
                notify: () => notifier.notifyUsers([ticket.assigned_vendor_id], {
                    ticketId: ticket.ticket_id,
                    title: 'Rework requested by JE',
                    message: `${remarks} Complete by ${newDate}.`,
                }),
            };
        },
    },

    revise_timeline: {
        role: ROLES.JE,
        from: [STAGES.DELAYED, STAGES.WORK_IN_PROGRESS],
        plan: async (ticket, body) => {
            const newDate = requireFutureDate(body.approved_completion_date, 'Revised completion date');
            const remarks = requireText(body.remarks, 'Remarks');
            return {
                toStage: STAGES.WORK_IN_PROGRESS,
                event: 'timeline_revised',
                remarks,
                details: { previous_date: ticket.approved_completion_date, approved_completion_date: newDate },
                updates: { approved_completion_date: newDate },
                notify: async () => {
                    await notifier.notifyUsers([ticket.assigned_vendor_id], {
                        ticketId: ticket.ticket_id,
                        title: 'Revised timeline approved',
                        message: `${remarks} New completion date: ${newDate}.`,
                    });
                    await notifier.notifySubmitter(ticket, {
                        ticketId: ticket.ticket_id,
                        title: 'Revised completion date',
                        message: `The expected completion date is now ${newDate}.`,
                    });
                },
            };
        },
    },

    escalate: {
        role: ROLES.JE,
        from: JE_ACTIVE_STAGES,
        plan: async (ticket, body) => {
            const reason = requireText(body.remarks, 'Escalation reason');
            return {
                toStage: STAGES.ESCALATED,
                event: 'escalated',
                remarks: reason,
                details: { escalated_from_stage: ticket.stage },
                updates: {
                    escalated_at: new Date(),
                    escalated_from_stage: ticket.stage,
                    escalation_reason: reason,
                    escalation_count: (ticket.escalation_count || 0) + 1,
                    escalation_decision: null,
                    escalation_remarks: null,
                    escalation_decided_by: null,
                    escalation_decided_at: null,
                },
                notify: async () => {
                    const payload = {
                        ticketId: ticket.ticket_id,
                        title: 'Complaint escalated by JE',
                        message: reason,
                        rows: [['Location', `${ticket.location_label} - ${ticket.exact_location}`], ['Issue', ticket.sub_category], ['JE', ticket.assigned_je_name]],
                    };
                    await notifier.notifyRole(ROLES.SENIOR_OFFICER, payload);
                    await notifier.notifyRole(ROLES.DIRECTOR, payload);
                },
            };
        },
    },

    escalation_decision: {
        role: ROLES.SENIOR_OFFICER,
        from: [STAGES.ESCALATED],
        plan: async (ticket, body, user) => {
            const remarks = requireText(body.remarks, 'Decision remarks');
            const decision = cleanText(body.decision);
            const decisionUpdates = {
                escalation_decision: decision,
                escalation_remarks: remarks,
                escalation_decided_by: Number(user.sub),
                escalation_decided_at: new Date(),
            };

            if (decision === 'continue_with_vendor') {
                if (!ticket.assigned_vendor_id) throw new GrievanceError('No vendor is assigned — choose "Reassign vendor" instead.');
                const newDate = requireFutureDate(body.approved_completion_date, 'Completion date');
                return {
                    toStage: STAGES.WORK_IN_PROGRESS,
                    event: 'escalation_decided',
                    remarks,
                    details: { decision, approved_completion_date: newDate },
                    updates: { ...decisionUpdates, approved_completion_date: newDate },
                    notify: () => notifier.notifyUsers([ticket.assigned_je_id, ticket.assigned_vendor_id], {
                        ticketId: ticket.ticket_id,
                        title: 'Senior officer decision: continue with vendor',
                        message: `${remarks} Work must be completed by ${newDate}.`,
                    }),
                };
            }

            if (decision === 'reassign_vendor') {
                const vendor = await requireVendorForTrade(body.vendor_id, ticket.trade);
                const dueAt = await siteVisitDeadline();
                return {
                    toStage: STAGES.ASSIGNED_TO_VENDOR,
                    event: 'escalation_decided',
                    remarks,
                    details: { decision, vendor_id: vendor.id, vendor_name: vendor.name, site_visit_due_at: dueAt.toISOString() },
                    updates: {
                        ...decisionUpdates,
                        assigned_vendor_id: vendor.id,
                        assigned_to: vendor.name.slice(0, 100),
                        vendor_assigned_at: new Date(),
                        site_visit_due_at: dueAt,
                        site_visit_at: null,
                        site_visit_overdue_at: null,
                        inspection_report: null,
                        pending_tasks: null,
                        vendor_estimated_date: null,
                        approved_completion_date: null,
                        progress_percent: 0,
                        work_completed_at: null,
                    },
                    notify: async () => {
                        await notifier.notifyUsers([vendor.id], {
                            ticketId: ticket.ticket_id,
                            title: 'New work assigned to you (escalated case)',
                            message: `Please visit the site and submit your inspection report by ${formatIst(dueAt)}.`,
                            rows: [['Location', `${ticket.location_label} - ${ticket.exact_location}`], ['Issue', ticket.sub_category]],
                        });
                        await notifier.notifyUsers([ticket.assigned_je_id], {
                            ticketId: ticket.ticket_id,
                            title: 'Senior officer reassigned the vendor',
                            message: `${remarks} New vendor: ${vendor.name}.`,
                        });
                        if (ticket.assigned_vendor_id && ticket.assigned_vendor_id !== vendor.id) {
                            await notifier.notifyUsers([ticket.assigned_vendor_id], {
                                ticketId: ticket.ticket_id,
                                title: 'Assignment withdrawn',
                                message: 'This ticket has been reassigned to another vendor after escalation.',
                            });
                        }
                    },
                };
            }

            throw new GrievanceError('Decision must be "continue_with_vendor" or "reassign_vendor".');
        },
    },

    assign_je: {
        role: ROLES.SUPER_ADMIN,
        from: ALL_STAGES.filter((stage) => stage !== STAGES.CLOSED),
        plan: async (ticket, body) => {
            const je = await model.getStaffMember(requireId(body.je_id, 'JE'), ROLES.JE);
            if (!je) throw new GrievanceError('Selected JE was not found or is inactive.');
            if (je.id === ticket.assigned_je_id) throw new GrievanceError('This JE is already handling the ticket.');
            return {
                toStage: ticket.stage === STAGES.UNROUTED ? STAGES.PENDING_JE_REVIEW : ticket.stage,
                event: 'je_assigned',
                remarks: optionalText(body.remarks, 'Remarks'),
                details: { je_id: je.id, je_name: je.name, previous_je_id: ticket.assigned_je_id },
                updates: { assigned_je_id: je.id },
                notify: () => notifier.notifyUsers([je.id], {
                    ticketId: ticket.ticket_id,
                    title: 'Complaint assigned to your inbox',
                    message: `${ticket.sub_category} at ${ticket.location_label} - ${ticket.exact_location}`,
                }),
            };
        },
    },
};

// Only the assigned JE / vendor may act on a ticket.
const ownerColumnForRole = {
    [ROLES.JE]: 'assigned_je_id',
    [ROLES.VENDOR]: 'assigned_vendor_id',
};

function allowedActionsFor(user, ticket) {
    return Object.entries(ACTIONS)
        .filter(([, action]) => {
            if (action.role !== user.role || !action.from.includes(ticket.stage)) return false;
            const ownerColumn = ownerColumnForRole[user.role];
            return !ownerColumn || ticket[ownerColumn] === Number(user.sub);
        })
        .map(([name]) => name);
}

async function performAction(user, ticketId, actionName, body = {}, file = null) {
    const action = ACTIONS[actionName];
    if (!action) {
        files.removeTemp(file);
        throw new GrievanceError('Unknown action.', 404);
    }

    let stored = null;
    try {
        const { ticket } = await loadVisibleTicket(user, ticketId);
        if (!allowedActionsFor(user, ticket).includes(actionName)) {
            throw new GrievanceError(`This action is not available while the ticket is "${STAGE_LABELS[ticket.stage] || ticket.stage}".`, 409);
        }

        const plan = await action.plan(ticket, body, user);
        stored = action.allowsAttachment ? await files.storeAttachment(file, ticket.ticket_id) : null;
        if (!action.allowsAttachment) files.removeTemp(file);

        const ownerColumn = ownerColumnForRole[user.role];
        const moved = await model.transition(
            ticket.ticket_id,
            [ticket.stage],
            plan.toStage,
            statusForStage(plan.toStage),
            plan.updates,
            ownerColumn ? { column: ownerColumn, value: Number(user.sub) } : null
        );
        if (!moved) {
            throw new GrievanceError('This ticket was just updated by someone else. Please refresh and try again.', 409);
        }

        await model.insertEvent({
            ticketId: ticket.ticket_id,
            action: plan.event,
            fromStage: ticket.stage,
            toStage: plan.toStage,
            ...actorOf(user),
            remarks: plan.remarks,
            details: plan.details,
            attachment: stored,
        });

        if (plan.notify) {
            const updated = await model.getTicket(ticket.ticket_id);
            Promise.resolve(plan.notify(updated)).catch((error) => {
                logError('Maintenance notification step failed', { ticketId: ticket.ticket_id, error: error.message });
            });
        }

        return getTicketDetail(user, ticket.ticket_id);
    } catch (error) {
        files.removeTemp(file);
        await files.discardAttachment(stored);
        throw error;
    }
}

/* ─── Submission ─── */

async function generateTicketId() {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 10; attempt++) {
        const ticketId = `${TICKET_PREFIX}-${year}-${crypto.randomInt(10000, 100000)}`;
        const exists = await query(`SELECT 1 FROM grievances WHERE ticket_id = $1`, [ticketId]);
        if (!exists.rowCount) return ticketId;
    }
    throw new Error('Failed to generate unique ticket ID');
}

async function submitTicket(user, body, file) {
    let stored = null;
    try {
        const categoryKey = cleanText(body.location_category);
        const location = await model.getActiveLocation(requireId(body.location_id, 'Location'), categoryKey);
        if (!location) throw new GrievanceError('Please select a valid location.');

        const issue = await model.getActiveIssueType(cleanText(body.issue_type));
        if (!issue) throw new GrievanceError('Please select a valid issue type.');

        const exactLocation = requireText(body.exact_location, 'Exact location', 300);
        const description = requireText(body.description, 'Description', 2000);
        if (wordCount(description) > DESCRIPTION_MAX_WORDS) {
            throw new GrievanceError(`Description must not exceed ${DESCRIPTION_MAX_WORDS} words.`);
        }

        const severityKey = cleanText(body.severity_level);
        const severity = SEVERITY_LEVELS[severityKey];
        if (!severity) throw new GrievanceError('Please select the severity level (Minor Repair or Major Repair).');

        const contact = optionalText(body.submitter_contact, 'Contact number', 15);
        if (contact && !/^[0-9+\-\s]{7,15}$/.test(contact)) throw new GrievanceError('Please enter a valid contact number.');

        const route = await model.findRoute({ locationCategory: location.category_key, issueType: issue.issue_key, trade: issue.trade });
        const ticketId = await generateTicketId();
        stored = await files.storeAttachment(file, ticketId);
        const stage = route ? STAGES.PENDING_JE_REVIEW : STAGES.UNROUTED;

        await model.createTicket({
            ticket_id: ticketId,
            workflow: WORKFLOW,
            stage,
            status: statusForStage(stage),
            submitter_type: 'faculty',
            submitter_id: String(user.sub),
            submitter_name: user.name,
            submitter_email: user.email,
            submitter_contact: contact,
            complaint_for: location.category_label,
            school_code: user.schoolCode || null,
            department_name: user.departmentName || null,
            category: FACULTY_CATEGORY,
            sub_category: issue.label,
            severity_level: severityKey,
            priority: severity.legacyPriority,
            subject: `${issue.label} - ${location.label}`.slice(0, 255),
            description,
            location_category: location.category_key,
            location_id: location.id,
            location_label: location.label,
            exact_location: exactLocation,
            issue_type: issue.issue_key,
            trade: issue.trade,
            routing_rule_id: route?.id || null,
            assigned_je_id: route?.je_user_id || null,
            attachment_path: stored?.path || null,
            attachment_mime: stored?.mime || null,
            is_student_grievance: false,
        });

        await model.insertEvent({
            ticketId,
            action: 'submitted',
            toStage: stage,
            ...actorOf(user),
            remarks: description,
            details: { location: `${location.category_label} / ${location.label}`, exact_location: exactLocation, issue_type: issue.label },
        });
        await model.insertEvent({
            ticketId,
            action: route ? 'routed' : 'unrouted',
            fromStage: stage,
            toStage: stage,
            ...SYSTEM_ACTOR,
            details: route ? { je_id: route.je_user_id, je_name: route.je_name } : {},
        });

        // notifier never throws, so these run in the background without delaying the response.
        const locationText = `${location.category_label} / ${location.label} - ${exactLocation}`;
        if (route) {
            notifier.notifyUsers([route.je_user_id], {
                ticketId,
                title: 'New complaint in your inbox',
                message: `${issue.label} complaint from ${user.name}.`,
                rows: [['Location', locationText], ['Severity', severity.label]],
            });
        } else {
            notifier.notifyRole(ROLES.SUPER_ADMIN, {
                ticketId,
                title: 'Complaint needs a JE',
                message: 'No routing rule matched this complaint. Please assign a JE from the admin panel.',
                rows: [['Location', locationText], ['Issue', issue.label]],
            });
        }
        notifier.notifyUsers([Number(user.sub)], {
            ticketId,
            title: 'Grievance registered',
            message: route ? `Your complaint has been sent to ${route.je_name}.` : 'Your complaint has been registered and will be assigned to a JE shortly.',
            rows: [['Location', locationText], ['Issue', issue.label]],
        });

        return { ticket_id: ticketId, stage, assigned_je_name: route?.je_name || null };
    } catch (error) {
        files.removeTemp(file);
        await files.discardAttachment(stored);
        throw error;
    }
}

/* ─── Reads ─── */

async function getMeta() {
    const [categories, locations, issueTypes] = await Promise.all([
        model.getLocationCategories({ activeOnly: true }),
        model.getLocations({ activeOnly: true }),
        model.getIssueTypes({ activeOnly: true }),
    ]);
    return {
        categories: categories.map((category) => ({
            ...category,
            locations: locations.filter((location) => location.category_key === category.category_key),
        })),
        issue_types: issueTypes,
        severity_levels: Object.entries(SEVERITY_LEVELS).map(([key, level]) => ({ key, label: level.label })),
        stage_labels: STAGE_LABELS,
        site_visit_working_days: SITE_VISIT_WORKING_DAYS,
    };
}

async function getMyTickets(user) {
    const rows = await model.listSubmitterTickets(String(user.sub));
    return rows.map((row) => presentTicket(row, 'owner'));
}

// ?date=YYYY-MM-DD or ?month=YYYY-MM (submission date, IST). Invalid values are ignored.
const parseDateFilters = (rawFilters) => {
    const date = cleanText(rawFilters.date);
    const month = cleanText(rawFilters.month);
    return {
        createdDate: /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : null,
        createdMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null,
    };
};

async function listTickets(user, rawFilters) {
    const scope = getViewerScope(user);
    if (!scope) throw new GrievanceError('You do not have access to maintenance tickets.', 403);

    const stages = String(rawFilters.stage || '')
        .split(',')
        .map((stage) => stage.trim())
        .filter((stage) => ALL_STAGES.includes(stage));
    const limit = Math.min(Math.max(parseInt(rawFilters.limit, 10) || 20, 1), 100);
    const page = Math.max(parseInt(rawFilters.page, 10) || 1, 1);

    const { rows, total } = await model.listTickets(
        scope,
        {
            stages,
            issueType: cleanText(rawFilters.issue_type) || null,
            locationCategory: cleanText(rawFilters.location_category) || null,
            jeId: parseInt(rawFilters.je_id, 10) || null,
            flag: cleanText(rawFilters.flag) || null,
            search: cleanText(rawFilters.search).slice(0, 100) || null,
            ...parseDateFilters(rawFilters),
        },
        { limit, offset: (page - 1) * limit }
    );

    return {
        items: rows.map((row) => presentTicket(row, scope.kind)),
        pagination: { total, page, limit, pages: Math.max(Math.ceil(total / limit), 1) },
    };
}

async function getStats(user, rawFilters = {}) {
    const scope = getViewerScope(user);
    if (!scope) throw new GrievanceError('You do not have access to maintenance tickets.', 403);

    const dateFilters = parseDateFilters(rawFilters);
    const rows = await model.countByStage(scope, dateFilters);
    const byStage = Object.fromEntries(ALL_STAGES.map((stage) => [stage, 0]));
    const stats = { total: 0, open: 0, in_progress: 0, escalated: 0, delayed: 0, resolved: 0, site_visit_overdue: 0, escalated_ever: 0 };

    for (const row of rows) {
        byStage[row.stage] = row.count;
        stats.total += row.count;
        stats.site_visit_overdue += row.site_visit_overdue;
        stats.escalated_ever += row.escalated_ever;
    }
    stats.open = byStage[STAGES.UNROUTED] + byStage[STAGES.PENDING_JE_REVIEW];
    stats.escalated = byStage[STAGES.ESCALATED];
    stats.delayed = byStage[STAGES.DELAYED];
    stats.resolved = byStage[STAGES.CLOSED];
    stats.in_progress = stats.total - stats.open - stats.escalated - stats.resolved;
    stats.pending = stats.total - stats.resolved;
    stats.by_stage = byStage;

    if (['admin', 'director', 'vc'].includes(scope.kind)) {
        stats.by_je = await model.countByJe(scope, dateFilters);
    }
    return stats;
}

async function getTicketDetail(user, ticketId) {
    const { ticket, viewer } = await loadVisibleTicket(user, ticketId);
    const events = await model.listEvents(ticket.ticket_id);
    return {
        ticket: presentTicket(ticket, viewer),
        events,
        viewer,
        allowed_actions: allowedActionsFor(user, ticket),
    };
}

async function getAttachment(user, ticketId, fileId) {
    const { ticket } = await loadVisibleTicket(user, ticketId);

    let stored;
    if (fileId === 'complaint') {
        stored = ticket.attachment_path ? { path: ticket.attachment_path, mime: ticket.attachment_mime, name: `${ticket.ticket_id}-attachment` } : null;
    } else {
        const event = await model.getEventAttachment(ticket.ticket_id, requireId(fileId, 'File'));
        stored = event ? { path: event.attachment_path, mime: event.attachment_mime, name: event.attachment_name } : null;
    }
    if (!stored) throw new GrievanceError('Attachment not found.', 404);

    return { ...stored, absolutePath: files.resolveAttachment(stored.path) };
}

async function listVendors(user, trade) {
    if (![ROLES.JE, ROLES.SENIOR_OFFICER, ROLES.SUPER_ADMIN].includes(user.role)) {
        throw new GrievanceError('Forbidden', 403);
    }
    const vendors = await model.listStaff({ staffType: ROLES.VENDOR, trade: cleanText(trade) || null });
    return vendors.map(({ id, name, trade: vendorTrade, company_name, phone }) => ({ id, name, trade: vendorTrade, company_name, phone }));
}

async function getMyStaffProfile(user) {
    const [profile] = (await model.listStaff({ activeOnly: false })).filter((row) => row.id === Number(user.sub));
    return profile || { id: Number(user.sub), name: user.name, role: user.role };
}

/* ─── Notifications ─── */

const getNotifications = (user) => model.listNotifications(Number(user.sub), 30);

async function markNotificationsRead(user, ids) {
    const cleanIds = Array.isArray(ids) ? ids.map(Number).filter((id) => Number.isInteger(id) && id > 0) : null;
    await model.markNotificationsRead(Number(user.sub), cleanIds);
}

/* ─── Admin configuration ─── */

async function getAdminConfig() {
    const [categories, locations, issueTypes, rules, holidays, staff] = await Promise.all([
        model.getLocationCategories({ activeOnly: false }),
        model.getLocations({ activeOnly: false }),
        model.getIssueTypes({ activeOnly: false }),
        model.listRoutingRules(),
        model.listHolidays(),
        model.listStaff({ activeOnly: false }),
    ]);
    return { categories, locations, issue_types: issueTypes, routing_rules: rules, holidays, staff };
}

// Super admin switch that opens / closes new complaint submission.
async function isModuleEnabled() {
    return (await model.getSetting('module_enabled')) !== 'false';
}

async function setModuleEnabled(user, enabled) {
    if (typeof enabled !== 'boolean') throw new GrievanceError('module_enabled must be true or false.');
    await model.setSetting('module_enabled', String(enabled), user.sub);
    return { module_enabled: enabled };
}

async function setCategoryActive(categoryKey, isActive) {
    if (typeof isActive !== 'boolean') throw new GrievanceError('is_active must be true or false.');
    const updated = await model.setCategoryActive(categoryKey, isActive);
    if (!updated) throw new GrievanceError('Category not found.', 404);
    return updated;
}

async function createLocation(body) {
    const categoryKey = cleanText(body.category_key);
    const categories = await model.getLocationCategories({ activeOnly: false });
    if (!categories.some((category) => category.category_key === categoryKey)) {
        throw new GrievanceError('Unknown location category.');
    }
    return model.createLocation({
        categoryKey,
        label: requireText(body.label, 'Location name', 255),
        sourceNo: optionalText(body.source_no, 'Source number', 20),
    });
}

async function updateLocation(id, body) {
    const updates = {};
    if (body.label !== undefined) updates.label = requireText(body.label, 'Location name', 255);
    if (body.source_no !== undefined) updates.sourceNo = optionalText(body.source_no, 'Source number', 20);
    if (body.is_active !== undefined) {
        if (typeof body.is_active !== 'boolean') throw new GrievanceError('is_active must be true or false.');
        updates.isActive = body.is_active;
    }
    const updated = await model.updateLocation(requireId(id, 'Location'), updates);
    if (!updated) throw new GrievanceError('Location not found.', 404);
    return updated;
}

async function updateRoutingRule(user, id, body) {
    let jeUserId;
    if (body.je_user_id !== undefined) {
        const je = await model.getStaffMember(requireId(body.je_user_id, 'JE'), ROLES.JE);
        if (!je) throw new GrievanceError('Selected JE was not found or is inactive.');
        jeUserId = je.id;
    }
    if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
        throw new GrievanceError('is_active must be true or false.');
    }
    const updated = await model.updateRoutingRule(requireId(id, 'Rule'), { jeUserId, isActive: body.is_active, updatedBy: Number(user.sub) });
    if (!updated) throw new GrievanceError('Routing rule not found.', 404);
    return updated;
}

async function addHoliday(body) {
    const date = cleanText(body.holiday_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
        throw new GrievanceError('Holiday date must be a valid date (YYYY-MM-DD).');
    }
    return model.upsertHoliday(date, requireText(body.label, 'Holiday name', 255));
}

async function removeHoliday(date) {
    const removed = await model.deleteHoliday(cleanText(date));
    if (!removed) throw new GrievanceError('Holiday not found.', 404);
}

/* ─── SLA sweep (scheduled) ─── */

/*
 * 1. Vendor missed the 2-working-day site visit -> flag it and notify the JE
 *    (the JE then follows up or escalates).
 * 2. Approved completion date passed without completion -> move to "delayed"
 *    and notify the JE and vendor.
 */
async function runSlaSweep() {
    const now = new Date();

    for (const ticketId of await model.findMissedSiteVisits()) {
        const flagged = await model.setTicketFields(ticketId, { site_visit_overdue_at: now }, { onlyIfNull: 'site_visit_overdue_at' });
        if (!flagged) continue;
        const ticket = await model.getTicket(ticketId);
        await model.insertEvent({
            ticketId,
            action: 'site_visit_missed',
            fromStage: ticket.stage,
            toStage: ticket.stage,
            ...SYSTEM_ACTOR,
            remarks: `Vendor did not visit within ${SITE_VISIT_WORKING_DAYS} working days.`,
            details: { site_visit_due_at: ticket.site_visit_due_at },
        });
        await notifier.notifyUsers([ticket.assigned_je_id], {
            ticketId,
            title: 'Vendor missed the site visit deadline',
            message: `${ticket.assigned_vendor_name || 'The vendor'} has not visited within ${SITE_VISIT_WORKING_DAYS} working days. Please follow up or escalate.`,
            rows: [['Location', `${ticket.location_label} - ${ticket.exact_location}`]],
        });
        await notifier.notifyUsers([ticket.assigned_vendor_id], {
            ticketId,
            title: 'Site visit overdue',
            message: 'The site-visit deadline for this ticket has passed. Please visit and submit your inspection report.',
        });
    }

    const today = todayIstKey(now);
    for (const ticketId of await model.findOverdueWork(today)) {
        const moved = await model.transition(ticketId, [STAGES.WORK_IN_PROGRESS], STAGES.DELAYED, statusForStage(STAGES.DELAYED), { delayed_at: now });
        if (!moved) continue;
        const ticket = await model.getTicket(ticketId);
        await model.insertEvent({
            ticketId,
            action: 'marked_delayed',
            fromStage: STAGES.WORK_IN_PROGRESS,
            toStage: STAGES.DELAYED,
            ...SYSTEM_ACTOR,
            remarks: `Work was not completed by the promised date (${ticket.approved_completion_date}).`,
            details: { approved_completion_date: ticket.approved_completion_date },
        });
        await notifier.notifyUsers([ticket.assigned_je_id], {
            ticketId,
            title: 'Work not completed by promised date',
            message: `Promised date ${ticket.approved_completion_date} has passed. Review the vendor's remarks and either approve a revised timeline or escalate.`,
        });
        await notifier.notifyUsers([ticket.assigned_vendor_id], {
            ticketId,
            title: 'Work overdue',
            message: `The promised completion date ${ticket.approved_completion_date} has passed. Please add a progress update explaining the delay.`,
        });
    }
}

async function runSlaSweepSafely() {
    try {
        await runSlaSweep();
    } catch (error) {
        logError('Maintenance SLA sweep failed', { error: error.message, stack: error.stack });
    }
}

module.exports = {
    getViewerScope,
    submitTicket,
    performAction,
    getMeta,
    getMyTickets,
    listTickets,
    getStats,
    getTicketDetail,
    getAttachment,
    listVendors,
    getMyStaffProfile,
    getNotifications,
    markNotificationsRead,
    getAdminConfig,
    isModuleEnabled,
    setModuleEnabled,
    setCategoryActive,
    createLocation,
    updateLocation,
    updateRoutingRule,
    addHoliday,
    removeHoliday,
    runSlaSweepSafely,
};
