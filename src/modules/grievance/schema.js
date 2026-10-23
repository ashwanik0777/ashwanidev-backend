const bcrypt = require('bcryptjs');
const { query } = require('../../config/db');
const { logInfo, logError } = require('../../config/logger');
const {
    LOCATION_CATEGORY_SEEDS,
    SCHOOL_LOCATION_SEEDS,
    RESIDENCE_LOCATION_SEEDS,
    OTHER_LOCATION_SEEDS,
    ISSUE_TYPE_SEEDS,
    STAFF_SEEDS,
    ROUTING_RULE_SEEDS,
} = require('./constants');

const GRIEVANCE_COLUMNS = [
    `workflow VARCHAR(20) NOT NULL DEFAULT 'legacy'`,
    `stage VARCHAR(40)`,
    `location_category VARCHAR(30)`,
    `location_id INT`,
    `location_label VARCHAR(255)`,
    `exact_location VARCHAR(500)`,
    `issue_type VARCHAR(40)`,
    `severity_level VARCHAR(20)`,
    `trade VARCHAR(20)`,
    `routing_rule_id INT`,
    `assigned_je_id INT`,
    `assigned_vendor_id INT`,
    `vendor_assigned_at TIMESTAMPTZ`,
    `site_visit_due_at TIMESTAMPTZ`,
    `site_visit_at TIMESTAMPTZ`,
    `site_visit_overdue_at TIMESTAMPTZ`,
    `follow_up_count INT NOT NULL DEFAULT 0`,
    `inspection_report TEXT`,
    `pending_tasks TEXT`,
    `vendor_estimated_date DATE`,
    `approved_completion_date DATE`,
    `progress_percent INT NOT NULL DEFAULT 0`,
    `work_completed_at TIMESTAMPTZ`,
    `delayed_at TIMESTAMPTZ`,
    `escalated_at TIMESTAMPTZ`,
    `escalated_from_stage VARCHAR(40)`,
    `escalation_reason TEXT`,
    `escalation_count INT NOT NULL DEFAULT 0`,
    `escalation_decision VARCHAR(40)`,
    `escalation_remarks TEXT`,
    `escalation_decided_by INT`,
    `escalation_decided_at TIMESTAMPTZ`,
    `rework_count INT NOT NULL DEFAULT 0`,
    `closed_at TIMESTAMPTZ`,
    `attachment_path VARCHAR(500)`,
    `attachment_mime VARCHAR(100)`,
];

// Core grievance table, module settings and the VC / HOD role column on users.
async function createBaseTables() {
    await query(`
        CREATE TABLE IF NOT EXISTS grievances (
            id SERIAL PRIMARY KEY,
            ticket_id VARCHAR(30) NOT NULL UNIQUE,
            submitter_type VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (submitter_type IN ('student', 'faculty')),
            submitter_id VARCHAR(50) NOT NULL,
            submitter_name VARCHAR(255) NOT NULL,
            submitter_email VARCHAR(150) NOT NULL,
            submitter_contact VARCHAR(15),
            hostel_or_designation VARCHAR(255),
            complaint_for VARCHAR(100),
            school_name VARCHAR(255),
            school_code VARCHAR(50),
            department_name VARCHAR(255),
            programme_name VARCHAR(255),
            category VARCHAR(100) NOT NULL,
            sub_category VARCHAR(100) NOT NULL,
            priority VARCHAR(10) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
            subject VARCHAR(255) NOT NULL,
            description TEXT NOT NULL,
            attachment_url VARCHAR(500),
            status VARCHAR(20) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Resolved', 'Rejected')),
            admin_remark TEXT,
            assigned_to VARCHAR(100),
            resolved_at TIMESTAMPTZ,
            is_student_grievance BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_ticket_id ON grievances(ticket_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_submitter ON grievances(submitter_id, submitter_type);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_status ON grievances(status);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_school_code ON grievances(school_code);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_dept_name ON grievances(department_name);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_category ON grievances(category);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_created_at ON grievances(created_at DESC);`);

    await query(`
        CREATE TABLE IF NOT EXISTS grievance_settings (
            id SERIAL PRIMARY KEY,
            setting_key VARCHAR(50) UNIQUE NOT NULL,
            setting_value VARCHAR(255),
            updated_by INT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
    await query(`
        INSERT INTO grievance_settings (setting_key, setting_value)
        VALUES ('module_enabled', 'true')
        ON CONFLICT (setting_key) DO NOTHING;
    `);

    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS grievance_role VARCHAR(20) DEFAULT NULL;`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_grievance_role ON users(grievance_role) WHERE grievance_role IS NOT NULL;`);
}

async function createTables() {
    for (const column of GRIEVANCE_COLUMNS) {
        await query(`ALTER TABLE grievances ADD COLUMN IF NOT EXISTS ${column};`);
    }
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_workflow_stage ON grievances(workflow, stage);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_assigned_je ON grievances(assigned_je_id) WHERE assigned_je_id IS NOT NULL;`);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_assigned_vendor ON grievances(assigned_vendor_id) WHERE assigned_vendor_id IS NOT NULL;`);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_escalated ON grievances(escalated_at) WHERE escalated_at IS NOT NULL;`);

    await query(`
        CREATE TABLE IF NOT EXISTS grv_location_categories (
            category_key VARCHAR(30) PRIMARY KEY,
            label VARCHAR(100) NOT NULL,
            picker_label VARCHAR(100) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE
        );
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS grv_locations (
            id SERIAL PRIMARY KEY,
            location_key VARCHAR(80) NOT NULL UNIQUE,
            category_key VARCHAR(30) NOT NULL REFERENCES grv_location_categories(category_key),
            label VARCHAR(255) NOT NULL,
            source_no VARCHAR(20),
            sort_order INT NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_locations_category ON grv_locations(category_key, is_active, sort_order);`);

    await query(`
        CREATE TABLE IF NOT EXISTS grv_issue_types (
            issue_key VARCHAR(40) PRIMARY KEY,
            label VARCHAR(100) NOT NULL,
            trade VARCHAR(20) NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE
        );
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS grv_staff_profiles (
            user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            staff_type VARCHAR(30) NOT NULL,
            trade VARCHAR(20),
            designation VARCHAR(255),
            company_name VARCHAR(255),
            phone VARCHAR(20),
            seed_key VARCHAR(60) UNIQUE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS grv_routing_rules (
            id SERIAL PRIMARY KEY,
            rule_key VARCHAR(60) NOT NULL UNIQUE,
            description VARCHAR(255),
            location_category VARCHAR(30),
            issue_type VARCHAR(40),
            trade VARCHAR(20),
            je_user_id INT REFERENCES users(id) ON DELETE SET NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            updated_by INT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS grv_holidays (
            holiday_date DATE PRIMARY KEY,
            label VARCHAR(255) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS grv_ticket_events (
            id SERIAL PRIMARY KEY,
            ticket_id VARCHAR(30) NOT NULL,
            action VARCHAR(50) NOT NULL,
            from_stage VARCHAR(40),
            to_stage VARCHAR(40),
            actor_id INT,
            actor_role VARCHAR(30),
            actor_name VARCHAR(255),
            remarks TEXT,
            details JSONB NOT NULL DEFAULT '{}'::jsonb,
            attachment_path VARCHAR(500),
            attachment_mime VARCHAR(100),
            attachment_name VARCHAR(255),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_events_ticket ON grv_ticket_events(ticket_id, created_at);`);

    await query(`
        CREATE TABLE IF NOT EXISTS grv_notifications (
            id SERIAL PRIMARY KEY,
            user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            ticket_id VARCHAR(30),
            title VARCHAR(255) NOT NULL,
            message TEXT,
            is_read BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_grv_notifications_user ON grv_notifications(user_id, is_read, created_at DESC);`);
}

async function seedLookups() {
    for (const category of LOCATION_CATEGORY_SEEDS) {
        await query(
            `INSERT INTO grv_location_categories (category_key, label, picker_label, sort_order, is_active)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (category_key) DO NOTHING`,
            [category.key, category.label, category.pickerLabel, category.sortOrder, category.isActive]
        );
    }

    const locations = [
        ...SCHOOL_LOCATION_SEEDS.map((code, index) => ({ key: `school:${code}`, category: 'school', label: code, sourceNo: null, sortOrder: index + 1 })),
        ...RESIDENCE_LOCATION_SEEDS.map((item, index) => ({ key: `residence:${item.sourceNo}`, category: 'residence', label: item.label, sourceNo: item.sourceNo, sortOrder: index + 1 })),
        ...OTHER_LOCATION_SEEDS.map(([sourceNo, label], index) => ({ key: `other:${sourceNo}`, category: 'other', label, sourceNo, sortOrder: index + 1 })),
    ];
    for (const location of locations) {
        await query(
            `INSERT INTO grv_locations (location_key, category_key, label, source_no, sort_order)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (location_key) DO NOTHING`,
            [location.key, location.category, location.label, location.sourceNo, location.sortOrder]
        );
    }

    for (const [index, issue] of ISSUE_TYPE_SEEDS.entries()) {
        await query(
            `INSERT INTO grv_issue_types (issue_key, label, trade, sort_order)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (issue_key) DO NOTHING`,
            [issue.key, issue.label, issue.trade, index + 1]
        );
    }
}

// Creates the temporary staff accounts once. Existing rows are never touched,
// so a password changed after the first login survives restarts.
async function seedStaff() {
    const userIdsBySeedKey = {};

    for (const seed of STAFF_SEEDS) {
        try {
            const existing = await query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [seed.email]);
            let userId = existing.rows[0]?.id;

            if (!userId) {
                const passwordHash = await bcrypt.hash(seed.password, 12);
                const inserted = await query(
                    `INSERT INTO users (name, email, username, role, password_hash, is_active, email_verified, force_password_reset)
                     VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, FALSE)
                     RETURNING id`,
                    [seed.name, seed.email, seed.username, seed.role, passwordHash]
                );
                userId = inserted.rows[0].id;
            }

            await query(
                `INSERT INTO grv_staff_profiles (user_id, staff_type, trade, designation, company_name, seed_key)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (user_id) DO NOTHING`,
                [userId, seed.role, seed.trade || null, seed.designation || null, seed.company || null, seed.key]
            );
            userIdsBySeedKey[seed.key] = userId;
        } catch (error) {
            logError(`Grievance staff seed skipped for ${seed.email}`, { error: error.message });
        }
    }

    for (const rule of ROUTING_RULE_SEEDS) {
        await query(
            `INSERT INTO grv_routing_rules (rule_key, description, location_category, issue_type, trade, je_user_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (rule_key) DO NOTHING`,
            [rule.key, rule.description, rule.locationCategory || null, rule.issueType || null, rule.trade || null, userIdsBySeedKey[rule.je] || null]
        );
    }
}

async function ensureGrievanceSchema() {
    try {
        await createBaseTables();
        await createTables();
        await seedLookups();
        await seedStaff();
        logInfo('Grievance schema ensured successfully.');
    } catch (error) {
        logError('Error ensuring grievance schema', { error: error.message, stack: error.stack });
        throw error;
    }
}

module.exports = { ensureGrievanceSchema };
