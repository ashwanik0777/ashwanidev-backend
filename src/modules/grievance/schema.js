const { query } = require('../../config/db');
const { logInfo, logError } = require('../../config/logger');

async function ensureGrievanceSchema() {
    try {
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

        // Create indexes
        await query(`CREATE INDEX IF NOT EXISTS idx_grv_ticket_id ON grievances(ticket_id);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_grv_submitter ON grievances(submitter_id, submitter_type);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_grv_status ON grievances(status);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_grv_school_code ON grievances(school_code);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_grv_dept_name ON grievances(department_name);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_grv_category ON grievances(category);`);
        await query(`CREATE INDEX IF NOT EXISTS idx_grv_created_at ON grievances(created_at DESC);`);

        // Audit Logs Table
        await query(`
            CREATE TABLE IF NOT EXISTS grievance_audit_logs (
                id SERIAL PRIMARY KEY,
                ticket_id VARCHAR(30) NOT NULL,
                action VARCHAR(100) NOT NULL,
                performed_by VARCHAR(255),
                performer_id INT,
                user_role VARCHAR(50),
                grievance_role VARCHAR(50),
                old_status VARCHAR(20),
                new_status VARCHAR(20),
                remark TEXT,
                ip_address INET,
                user_agent TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        // Settings Table
        await query(`
            CREATE TABLE IF NOT EXISTS grievance_settings (
                id SERIAL PRIMARY KEY,
                setting_key VARCHAR(50) UNIQUE NOT NULL,
                setting_value VARCHAR(255),
                updated_by INT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
        `);

        // Insert default settings
        await query(`
            INSERT INTO grievance_settings (setting_key, setting_value)
            VALUES 
                ('module_enabled', 'true'),
                ('student_module_enabled', 'false')
            ON CONFLICT (setting_key) DO NOTHING;
        `);

        // Alter users table
        await query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS grievance_role VARCHAR(20) DEFAULT NULL;
        `);

        await query(`
            CREATE INDEX IF NOT EXISTS idx_users_grievance_role 
            ON users(grievance_role) 
            WHERE grievance_role IS NOT NULL;
        `);

        logInfo('Grievance schema ensured successfully.');
    } catch (error) {
        logError('Error ensuring grievance schema', error);
        throw error;
    }
}

module.exports = { ensureGrievanceSchema };
