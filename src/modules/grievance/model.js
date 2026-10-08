const { query } = require('../../config/db');

async function createGrievance(data) {
    const text = `
        INSERT INTO grievances (
            ticket_id, submitter_type, submitter_id, submitter_name, submitter_email,
            submitter_contact, hostel_or_designation, complaint_for, school_name,
            school_code, department_name, programme_name, category, sub_category,
            priority, subject, description, attachment_url, is_student_grievance
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
        ) RETURNING *;
    `;
    const values = [
        data.ticket_id, data.submitter_type, data.submitter_id, data.submitter_name, data.submitter_email,
        data.submitter_contact, data.hostel_or_designation, data.complaint_for, data.school_name,
        data.school_code, data.department_name, data.programme_name, data.category, data.sub_category,
        data.priority, data.subject, data.description, data.attachment_url, data.is_student_grievance || false
    ];
    const result = await query(text, values);
    return result.rows[0];
}

async function getGrievancesBySubmitter(submitterId, submitterType) {
    const result = await query(
        `SELECT * FROM grievances WHERE submitter_id = $1 AND submitter_type = $2 ORDER BY created_at DESC`,
        [submitterId, submitterType]
    );
    return result.rows;
}

async function getGrievanceDetail(ticketId) {
    const result = await query(`SELECT * FROM grievances WHERE ticket_id = $1`, [ticketId]);
    return result.rows[0];
}

async function getGrievanceDetailForSubmitter(ticketId, submitterId) {
    const result = await query(
        `SELECT * FROM grievances WHERE ticket_id = $1 AND submitter_id = $2`,
        [ticketId, submitterId]
    );
    return result.rows[0];
}

async function getAllGrievances(filters, scope) {
    let whereClause = scope.where || '1=1';
    let params = [...(scope.params || [])];
    let paramIndex = params.length + 1;

    if (filters.status && filters.status !== 'All') {
        whereClause += ` AND status = $${paramIndex++}`;
        params.push(filters.status);
    }
    if (filters.category && filters.category !== 'All') {
        whereClause += ` AND category = $${paramIndex++}`;
        params.push(filters.category);
    }
    if (filters.submitterType && filters.submitterType !== 'All') {
        whereClause += ` AND submitter_type = $${paramIndex++}`;
        params.push(filters.submitterType.toLowerCase());
    }
    if (filters.school && filters.school !== 'All Schools' && filters.school !== 'All') {
        whereClause += ` AND (school_name = $${paramIndex} OR school_code = $${paramIndex})`;
        params.push(filters.school);
        paramIndex++;
    }
    if (filters.search) {
        whereClause += ` AND (ticket_id ILIKE $${paramIndex} OR submitter_name ILIKE $${paramIndex} OR subject ILIKE $${paramIndex})`;
        params.push(`%${filters.search}%`);
        paramIndex++;
    }

    // Count total for pagination
    const countResult = await query(`SELECT COUNT(*) as total FROM grievances WHERE ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].total, 10);

    let queryText = `SELECT * FROM grievances WHERE ${whereClause} ORDER BY created_at DESC`;

    if (filters.limit && filters.page) {
        const limit = parseInt(filters.limit, 10);
        const offset = (parseInt(filters.page, 10) - 1) * limit;
        queryText += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(limit, offset);
    }

    const result = await query(queryText, params);
    return { data: result.rows, total };
}

async function getGrievanceStats(scope) {
    const whereClause = scope.where || '1=1';
    const params = scope.params || [];
    
    const result = await query(`
        SELECT status, COUNT(*) as count 
        FROM grievances 
        WHERE ${whereClause} 
        GROUP BY status
    `, params);
    return result.rows;
}

async function updateGrievanceStatus(ticketId, status, adminRemark, assignedTo) {
    let text = `
        UPDATE grievances 
        SET status = $1, admin_remark = $2, assigned_to = $3
    `;
    if (status === 'Resolved' || status === 'Rejected') {
        text += `, resolved_at = NOW()`;
    } else {
        text += `, updated_at = NOW()`;
    }
    text += ` WHERE ticket_id = $4 RETURNING *;`;
    
    const result = await query(text, [status, adminRemark, assignedTo, ticketId]);
    return result.rows[0];
}

async function ticketIdExists(ticketId) {
    const result = await query(`SELECT 1 FROM grievances WHERE ticket_id = $1 LIMIT 1`, [ticketId]);
    return result.rowCount > 0;
}

async function createAuditLog(data) {
    const text = `
        INSERT INTO grievance_audit_logs (
            ticket_id, action, performed_by, performer_id, user_role, 
            grievance_role, old_status, new_status, remark, ip_address, user_agent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *;
    `;
    const values = [
        data.ticket_id, data.action, data.performed_by, data.performer_id, data.user_role,
        data.grievance_role, data.old_status, data.new_status, data.remark, data.ip_address, data.user_agent
    ];
    const result = await query(text, values);
    return result.rows[0];
}

async function getGrievanceSetting(key) {
    const result = await query(`SELECT setting_value FROM grievance_settings WHERE setting_key = $1`, [key]);
    return result.rows[0] ? result.rows[0].setting_value : null;
}

async function updateGrievanceSetting(key, value, updatedBy) {
    const text = `
        INSERT INTO grievance_settings (setting_key, setting_value, updated_by, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (setting_key) DO UPDATE 
        SET setting_value = EXCLUDED.setting_value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
        RETURNING *;
    `;
    const result = await query(text, [key, value, updatedBy]);
    return result.rows[0];
}

async function exportGrievances(scope) {
    const whereClause = scope.where || '1=1';
    const params = scope.params || [];
    const result = await query(`SELECT * FROM grievances WHERE ${whereClause} ORDER BY created_at DESC`, params);
    return result.rows;
}

module.exports = {
    createGrievance,
    getGrievancesBySubmitter,
    getGrievanceDetail,
    getGrievanceDetailForSubmitter,
    getAllGrievances,
    getGrievanceStats,
    updateGrievanceStatus,
    ticketIdExists,
    createAuditLog,
    getGrievanceSetting,
    updateGrievanceSetting,
    exportGrievances
};
