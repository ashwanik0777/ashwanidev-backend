const { query } = require('../../config/db');
const { WORKFLOW } = require('./constants');

const TICKET_SELECT = `
    SELECT g.*,
           je.name AS assigned_je_name,
           je_p.designation AS assigned_je_designation,
           vendor.name AS assigned_vendor_name,
           vendor_p.company_name AS assigned_vendor_company,
           vendor_p.phone AS assigned_vendor_phone,
           decider.name AS escalation_decided_by_name
    FROM grievances g
    LEFT JOIN users je ON je.id = g.assigned_je_id
    LEFT JOIN grv_staff_profiles je_p ON je_p.user_id = g.assigned_je_id
    LEFT JOIN users vendor ON vendor.id = g.assigned_vendor_id
    LEFT JOIN grv_staff_profiles vendor_p ON vendor_p.user_id = g.assigned_vendor_id
    LEFT JOIN users decider ON decider.id = g.escalation_decided_by
`;

// Columns a workflow transition is allowed to write; keeps the dynamic SET clause server-controlled.
const UPDATABLE_COLUMNS = new Set([
    'assigned_je_id', 'assigned_vendor_id', 'vendor_assigned_at', 'site_visit_due_at', 'site_visit_at',
    'site_visit_overdue_at', 'follow_up_count', 'inspection_report', 'pending_tasks', 'vendor_estimated_date',
    'approved_completion_date', 'progress_percent', 'work_completed_at', 'delayed_at', 'escalated_at',
    'escalated_from_stage', 'escalation_reason', 'escalation_count', 'escalation_decision', 'escalation_remarks',
    'escalation_decided_by', 'escalation_decided_at', 'rework_count', 'closed_at', 'resolved_at',
    'admin_remark', 'assigned_to',
]);

/* ─── Lookups ─── */

async function getLocationCategories({ activeOnly }) {
    const result = await query(
        `SELECT category_key, label, picker_label, sort_order, is_active
         FROM grv_location_categories
         ${activeOnly ? 'WHERE is_active = TRUE' : ''}
         ORDER BY sort_order, label`
    );
    return result.rows;
}

async function getLocations({ activeOnly }) {
    const result = await query(
        `SELECT l.id, l.location_key, l.category_key, l.label, l.source_no, l.sort_order, l.is_active
         FROM grv_locations l
         JOIN grv_location_categories c ON c.category_key = l.category_key
         ${activeOnly ? 'WHERE l.is_active = TRUE AND c.is_active = TRUE' : ''}
         ORDER BY c.sort_order, l.sort_order, l.label`
    );
    return result.rows;
}

async function getIssueTypes({ activeOnly }) {
    const result = await query(
        `SELECT issue_key, label, trade, sort_order, is_active
         FROM grv_issue_types
         ${activeOnly ? 'WHERE is_active = TRUE' : ''}
         ORDER BY sort_order, label`
    );
    return result.rows;
}

async function getActiveLocation(locationId, categoryKey) {
    const result = await query(
        `SELECT l.id, l.label, l.category_key, c.label AS category_label
         FROM grv_locations l
         JOIN grv_location_categories c ON c.category_key = l.category_key
         WHERE l.id = $1 AND l.category_key = $2 AND l.is_active = TRUE AND c.is_active = TRUE`,
        [locationId, categoryKey]
    );
    return result.rows[0] || null;
}

async function getActiveIssueType(issueKey) {
    const result = await query(
        `SELECT issue_key, label, trade FROM grv_issue_types WHERE issue_key = $1 AND is_active = TRUE`,
        [issueKey]
    );
    return result.rows[0] || null;
}

/*
 * Picks the JE for a complaint. A rule matches when each of its set fields
 * equals the complaint's value (NULL = any). The most specific match wins:
 * an exact issue type beats a location, which beats a trade.
 */
async function findRoute({ locationCategory, issueType, trade }) {
    const result = await query(
        `SELECT r.id, r.je_user_id, u.name AS je_name
         FROM grv_routing_rules r
         JOIN users u ON u.id = r.je_user_id AND u.is_active = TRUE AND u.role = 'je'
         WHERE r.is_active = TRUE
           AND (r.location_category IS NULL OR r.location_category = $1)
           AND (r.issue_type IS NULL OR r.issue_type = $2)
           AND (r.trade IS NULL OR r.trade = $3)
         ORDER BY (CASE WHEN r.issue_type IS NOT NULL THEN 4 ELSE 0 END)
                + (CASE WHEN r.location_category IS NOT NULL THEN 2 ELSE 0 END)
                + (CASE WHEN r.trade IS NOT NULL THEN 1 ELSE 0 END) DESC,
                r.id
         LIMIT 1`,
        [locationCategory, issueType, trade]
    );
    return result.rows[0] || null;
}

/* ─── Tickets ─── */

async function createTicket(data) {
    const columns = Object.keys(data);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    const result = await query(
        `INSERT INTO grievances (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ticket_id`,
        columns.map((column) => data[column])
    );
    return result.rows[0];
}

async function getTicket(ticketId) {
    const result = await query(`${TICKET_SELECT} WHERE g.workflow = $1 AND g.ticket_id = $2`, [WORKFLOW, ticketId]);
    return result.rows[0] || null;
}

const appendFilters = (scope, filters) => {
    const clauses = [`g.workflow = '${WORKFLOW}'`, scope.where];
    const params = [...scope.params];
    const next = () => `$${params.length}`;

    if (filters.stages?.length) {
        params.push(filters.stages);
        clauses.push(`g.stage = ANY(${next()})`);
    }
    if (filters.issueType) {
        params.push(filters.issueType);
        clauses.push(`g.issue_type = ${next()}`);
    }
    if (filters.locationCategory) {
        params.push(filters.locationCategory);
        clauses.push(`g.location_category = ${next()}`);
    }
    if (filters.jeId) {
        params.push(filters.jeId);
        clauses.push(`g.assigned_je_id = ${next()}`);
    }
    // Day / month filters on the complaint's submission date, in IST.
    if (filters.createdDate) {
        params.push(filters.createdDate);
        clauses.push(`(g.created_at AT TIME ZONE 'Asia/Kolkata')::date = ${next()}::date`);
    }
    if (filters.createdMonth) {
        params.push(filters.createdMonth);
        clauses.push(`to_char(g.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') = ${next()}`);
    }
    if (filters.flag === 'site_visit_overdue') clauses.push(`g.site_visit_overdue_at IS NOT NULL AND g.stage = 'assigned_to_vendor'`);
    if (filters.flag === 'escalated_ever') clauses.push(`g.escalated_at IS NOT NULL`);
    if (filters.search) {
        params.push(`%${filters.search}%`);
        clauses.push(`(g.ticket_id ILIKE ${next()} OR g.submitter_name ILIKE ${next()} OR g.location_label ILIKE ${next()} OR g.exact_location ILIKE ${next()})`);
    }

    return { where: clauses.join(' AND '), params };
};

async function listTickets(scope, filters, { limit, offset }) {
    const { where, params } = appendFilters(scope, filters);
    const countResult = await query(`SELECT COUNT(*)::int AS total FROM grievances g WHERE ${where}`, params);

    const listParams = [...params, limit, offset];
    const result = await query(
        `${TICKET_SELECT}
         WHERE ${where}
         ORDER BY
            CASE g.stage WHEN 'closed' THEN 1 ELSE 0 END,
            g.updated_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
    );
    return { rows: result.rows, total: countResult.rows[0].total };
}

async function listSubmitterTickets(submitterId) {
    const result = await query(
        `${TICKET_SELECT}
         WHERE g.workflow = $1 AND g.submitter_type = 'faculty' AND g.submitter_id = $2
         ORDER BY g.created_at DESC`,
        [WORKFLOW, submitterId]
    );
    return result.rows;
}

async function countByStage(scope, filters = {}) {
    const { where, params } = appendFilters(scope, filters);
    const result = await query(
        `SELECT g.stage,
                COUNT(*)::int AS count,
                COUNT(*) FILTER (WHERE g.site_visit_overdue_at IS NOT NULL AND g.stage = 'assigned_to_vendor')::int AS site_visit_overdue,
                COUNT(*) FILTER (WHERE g.escalated_at IS NOT NULL)::int AS escalated_ever
         FROM grievances g
         WHERE ${where}
         GROUP BY g.stage`,
        params
    );
    return result.rows;
}

async function countByJe(scope, filters = {}) {
    const { where, params } = appendFilters(scope, filters);
    const result = await query(
        `SELECT g.assigned_je_id AS je_id,
                COALESCE(je.name, 'Unassigned') AS je_name,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE g.stage = 'closed')::int AS closed,
                COUNT(*) FILTER (WHERE g.stage = 'escalated')::int AS escalated,
                COUNT(*) FILTER (WHERE g.stage = 'delayed')::int AS delayed
         FROM grievances g
         LEFT JOIN users je ON je.id = g.assigned_je_id
         WHERE ${where}
         GROUP BY g.assigned_je_id, je.name
         ORDER BY je_name`,
        params
    );
    return result.rows;
}

/*
 * Moves a ticket to `toStage`, but only if it is still in one of `fromStages`.
 * Returns null when another user moved it first, so two people acting on the
 * same ticket can't both succeed.
 */
async function transition(ticketId, fromStages, toStage, status, updates = {}, extraWhere = null) {
    const params = [ticketId, WORKFLOW, fromStages, toStage, status];
    const sets = ['stage = $4', 'status = $5', 'updated_at = NOW()'];

    for (const [column, value] of Object.entries(updates)) {
        if (!UPDATABLE_COLUMNS.has(column)) throw new Error(`Column not updatable: ${column}`);
        params.push(value);
        sets.push(`${column} = $${params.length}`);
    }

    let where = 'ticket_id = $1 AND workflow = $2 AND stage = ANY($3)';
    if (extraWhere) {
        params.push(extraWhere.value);
        where += ` AND ${extraWhere.column} = $${params.length}`;
    }

    const result = await query(`UPDATE grievances SET ${sets.join(', ')} WHERE ${where} RETURNING ticket_id`, params);
    return result.rows[0] || null;
}

async function setTicketFields(ticketId, updates, { onlyIfNull }) {
    const params = [ticketId, WORKFLOW];
    const sets = ['updated_at = NOW()'];
    for (const [column, value] of Object.entries(updates)) {
        if (!UPDATABLE_COLUMNS.has(column)) throw new Error(`Column not updatable: ${column}`);
        params.push(value);
        sets.push(`${column} = $${params.length}`);
    }
    const guard = onlyIfNull ? ` AND ${onlyIfNull} IS NULL` : '';
    const result = await query(
        `UPDATE grievances SET ${sets.join(', ')} WHERE ticket_id = $1 AND workflow = $2${guard} RETURNING ticket_id`,
        params
    );
    return result.rows[0] || null;
}

/* ─── Events (timeline) ─── */

async function insertEvent(event) {
    const result = await query(
        `INSERT INTO grv_ticket_events
            (ticket_id, action, from_stage, to_stage, actor_id, actor_role, actor_name, remarks, details,
             attachment_path, attachment_mime, attachment_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
         RETURNING id`,
        [
            event.ticketId, event.action, event.fromStage || null, event.toStage || null,
            event.actorId || null, event.actorRole || null, event.actorName || null, event.remarks || null,
            JSON.stringify(event.details || {}),
            event.attachment?.path || null, event.attachment?.mime || null, event.attachment?.name || null,
        ]
    );
    return result.rows[0];
}

async function listEvents(ticketId) {
    const result = await query(
        `SELECT id, action, from_stage, to_stage, actor_id, actor_role, actor_name, remarks, details,
                attachment_name, attachment_mime, (attachment_path IS NOT NULL) AS has_attachment, created_at
         FROM grv_ticket_events
         WHERE ticket_id = $1
         ORDER BY created_at, id`,
        [ticketId]
    );
    return result.rows;
}

async function getEventAttachment(ticketId, eventId) {
    const result = await query(
        `SELECT attachment_path, attachment_mime, attachment_name
         FROM grv_ticket_events
         WHERE ticket_id = $1 AND id = $2 AND attachment_path IS NOT NULL`,
        [ticketId, eventId]
    );
    return result.rows[0] || null;
}

/* ─── Staff ─── */

async function listStaff({ staffType, trade, activeOnly = true }) {
    const params = [];
    const clauses = [];
    if (staffType) {
        params.push(staffType);
        clauses.push(`u.role = $${params.length}`);
    } else {
        clauses.push(`u.role IN ('je', 'vendor', 'senior_officer', 'director')`);
    }
    if (trade) {
        params.push(trade);
        clauses.push(`p.trade = $${params.length}`);
    }
    if (activeOnly) clauses.push('u.is_active = TRUE AND COALESCE(p.is_active, TRUE) = TRUE');

    const result = await query(
        `SELECT u.id, u.name, u.email, u.username, u.role, u.is_active,
                p.trade, p.designation, p.company_name, p.phone, COALESCE(p.is_active, TRUE) AS profile_active
         FROM users u
         LEFT JOIN grv_staff_profiles p ON p.user_id = u.id
         WHERE ${clauses.join(' AND ')}
         ORDER BY u.role, u.name`,
        params
    );
    return result.rows;
}

async function getStaffMember(userId, staffType) {
    const result = await query(
        `SELECT u.id, u.name, u.email, u.role, p.trade, p.company_name
         FROM users u
         LEFT JOIN grv_staff_profiles p ON p.user_id = u.id
         WHERE u.id = $1 AND u.role = $2 AND u.is_active = TRUE AND COALESCE(p.is_active, TRUE) = TRUE`,
        [userId, staffType]
    );
    return result.rows[0] || null;
}

async function getActiveUserIdsByRole(role) {
    const result = await query(`SELECT id FROM users WHERE role = $1 AND is_active = TRUE`, [role]);
    return result.rows.map((row) => row.id);
}

async function getUsersByIds(ids) {
    if (!ids.length) return [];
    const result = await query(`SELECT id, name, email FROM users WHERE id = ANY($1::int[]) AND is_active = TRUE`, [ids]);
    return result.rows;
}

/* ─── Holidays ─── */

async function listHolidays({ fromDate } = {}) {
    const result = fromDate
        ? await query(`SELECT holiday_date, label FROM grv_holidays WHERE holiday_date >= $1 ORDER BY holiday_date`, [fromDate])
        : await query(`SELECT holiday_date, label FROM grv_holidays ORDER BY holiday_date`);
    return result.rows;
}

async function upsertHoliday(date, label) {
    const result = await query(
        `INSERT INTO grv_holidays (holiday_date, label) VALUES ($1, $2)
         ON CONFLICT (holiday_date) DO UPDATE SET label = EXCLUDED.label
         RETURNING holiday_date, label`,
        [date, label]
    );
    return result.rows[0];
}

async function deleteHoliday(date) {
    const result = await query(`DELETE FROM grv_holidays WHERE holiday_date = $1`, [date]);
    return result.rowCount > 0;
}

/* ─── Admin configuration ─── */

async function setCategoryActive(categoryKey, isActive) {
    const result = await query(
        `UPDATE grv_location_categories SET is_active = $2 WHERE category_key = $1 RETURNING category_key, is_active`,
        [categoryKey, isActive]
    );
    return result.rows[0] || null;
}

async function createLocation({ categoryKey, label, sourceNo }) {
    const result = await query(
        `INSERT INTO grv_locations (location_key, category_key, label, source_no, sort_order)
         VALUES (
            $1 || ':custom-' || substr(md5(random()::text), 1, 10),
            $1, $2, $3,
            COALESCE((SELECT MAX(sort_order) FROM grv_locations WHERE category_key = $1), 0) + 1
         )
         RETURNING id, location_key, category_key, label, source_no, sort_order, is_active`,
        [categoryKey, label, sourceNo || null]
    );
    return result.rows[0];
}

async function updateLocation(id, { label, sourceNo, isActive }) {
    const result = await query(
        `UPDATE grv_locations
         SET label = COALESCE($2, label),
             source_no = CASE WHEN $3::boolean THEN $4 ELSE source_no END,
             is_active = COALESCE($5, is_active)
         WHERE id = $1
         RETURNING id, location_key, category_key, label, source_no, sort_order, is_active`,
        [id, label ?? null, sourceNo !== undefined, sourceNo ?? null, isActive ?? null]
    );
    return result.rows[0] || null;
}

async function listRoutingRules() {
    const result = await query(
        `SELECT r.id, r.rule_key, r.description, r.location_category, r.issue_type, r.trade,
                r.je_user_id, u.name AS je_name, r.is_active, r.updated_at
         FROM grv_routing_rules r
         LEFT JOIN users u ON u.id = r.je_user_id
         ORDER BY r.id`
    );
    return result.rows;
}

async function updateRoutingRule(id, { jeUserId, isActive, updatedBy }) {
    const result = await query(
        `UPDATE grv_routing_rules
         SET je_user_id = COALESCE($2, je_user_id),
             is_active = COALESCE($3, is_active),
             updated_by = $4,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [id, jeUserId ?? null, isActive ?? null, updatedBy]
    );
    return result.rows[0] || null;
}

/* ─── Notifications ─── */

async function insertNotifications(userIds, { ticketId, title, message }) {
    if (!userIds.length) return;
    await query(
        `INSERT INTO grv_notifications (user_id, ticket_id, title, message)
         SELECT unnest($1::int[]), $2, $3, $4`,
        [userIds, ticketId || null, title, message || null]
    );
}

async function listNotifications(userId, limit) {
    const result = await query(
        `SELECT id, ticket_id, title, message, is_read, created_at
         FROM grv_notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
    );
    const unread = await query(`SELECT COUNT(*)::int AS count FROM grv_notifications WHERE user_id = $1 AND is_read = FALSE`, [userId]);
    return { items: result.rows, unread: unread.rows[0].count };
}

async function markNotificationsRead(userId, ids) {
    if (ids?.length) {
        await query(`UPDATE grv_notifications SET is_read = TRUE WHERE user_id = $1 AND id = ANY($2::int[])`, [userId, ids]);
    } else {
        await query(`UPDATE grv_notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`, [userId]);
    }
}

/* ─── SLA sweep ─── */

async function findMissedSiteVisits() {
    const result = await query(
        `SELECT ticket_id FROM grievances
         WHERE workflow = $1 AND stage = 'assigned_to_vendor'
           AND site_visit_due_at < NOW() AND site_visit_overdue_at IS NULL`,
        [WORKFLOW]
    );
    return result.rows.map((row) => row.ticket_id);
}

async function findOverdueWork(todayKey) {
    const result = await query(
        `SELECT ticket_id FROM grievances
         WHERE workflow = $1 AND stage = 'work_in_progress'
           AND approved_completion_date IS NOT NULL AND approved_completion_date < $2::date`,
        [WORKFLOW, todayKey]
    );
    return result.rows.map((row) => row.ticket_id);
}

/* ─── Module settings ─── */

async function getSetting(key) {
    const result = await query(`SELECT setting_value FROM grievance_settings WHERE setting_key = $1`, [key]);
    return result.rows[0] ? result.rows[0].setting_value : null;
}

async function setSetting(key, value, updatedBy) {
    await query(
        `INSERT INTO grievance_settings (setting_key, setting_value, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (setting_key) DO UPDATE
         SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [key, value, updatedBy]
    );
}

module.exports = {
    getLocationCategories,
    getLocations,
    getIssueTypes,
    getActiveLocation,
    getActiveIssueType,
    findRoute,
    createTicket,
    getTicket,
    listTickets,
    listSubmitterTickets,
    countByStage,
    countByJe,
    transition,
    setTicketFields,
    insertEvent,
    listEvents,
    getEventAttachment,
    listStaff,
    getStaffMember,
    getActiveUserIdsByRole,
    getUsersByIds,
    listHolidays,
    upsertHoliday,
    deleteHoliday,
    setCategoryActive,
    createLocation,
    updateLocation,
    listRoutingRules,
    updateRoutingRule,
    insertNotifications,
    listNotifications,
    markNotificationsRead,
    findMissedSiteVisits,
    findOverdueWork,
    getSetting,
    setSetting,
};
