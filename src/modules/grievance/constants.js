/*
 * Faculty maintenance grievance workflow.
 *
 * Faculty -> routed to one of the JEs (by location + issue type) -> JE assigns a
 * vendor -> vendor must visit within 2 working days -> vendor inspects and gives
 * an estimated date -> JE approves the date -> vendor works -> JE verifies and
 * closes (or asks for rework). A JE can escalate to the senior officers at any
 * point once a vendor is involved; the Director (and VC / HOD) only watch.
 */

const WORKFLOW = 'maintenance';
const TICKET_PREFIX = 'FAC-GRV';
const FACULTY_CATEGORY = 'Faculty Maintenance';
const SITE_VISIT_WORKING_DAYS = 2;
const DESCRIPTION_MAX_WORDS = 100;

const STAGES = {
    UNROUTED: 'unrouted',
    PENDING_JE_REVIEW: 'pending_je_review',
    ASSIGNED_TO_VENDOR: 'assigned_to_vendor',
    INSPECTION_SUBMITTED: 'inspection_submitted',
    WORK_IN_PROGRESS: 'work_in_progress',
    DELAYED: 'delayed',
    WORK_COMPLETED: 'work_completed',
    ESCALATED: 'escalated',
    CLOSED: 'closed',
};

const STAGE_LABELS = {
    [STAGES.UNROUTED]: 'Awaiting JE Assignment',
    [STAGES.PENDING_JE_REVIEW]: 'Under JE Review',
    [STAGES.ASSIGNED_TO_VENDOR]: 'Assigned to Vendor',
    [STAGES.INSPECTION_SUBMITTED]: 'Inspection Report Submitted',
    [STAGES.WORK_IN_PROGRESS]: 'Work in Progress',
    [STAGES.DELAYED]: 'Delayed',
    [STAGES.WORK_COMPLETED]: 'Work Completed - Awaiting Verification',
    [STAGES.ESCALATED]: 'Escalated to Senior Officers',
    [STAGES.CLOSED]: 'Resolved & Closed',
};

const ALL_STAGES = Object.values(STAGES);
const OPEN_STAGES = [STAGES.UNROUTED, STAGES.PENDING_JE_REVIEW];

// The legacy `status` column is kept in sync so older screens and exports still make sense.
const statusForStage = (stage) => {
    if (stage === STAGES.CLOSED) return 'Resolved';
    if (OPEN_STAGES.includes(stage)) return 'Open';
    return 'In Progress';
};

const LOCATION_CATEGORY_SEEDS = [
    { key: 'school', label: 'School', pickerLabel: 'Select School', sortOrder: 1, isActive: true },
    { key: 'residence', label: 'Residence', pickerLabel: 'Select Faculty Residence', sortOrder: 2, isActive: true },
    // Hostel grievances are planned but not live yet. The category and its routing
    // rule exist so it can be switched on later from the admin panel.
    { key: 'hostel', label: 'Hostel', pickerLabel: 'Select Hostel', sortOrder: 3, isActive: false },
    { key: 'other', label: 'Others', pickerLabel: 'Select Campus Facility', sortOrder: 4, isActive: true },
];

const SCHOOL_LOCATION_SEEDS = ['SOICT', 'SOBT', 'SOBSC', 'SOE', 'SOL', 'SOM', 'SOHSS', 'SOVS'];

const RESIDENCE_LOCATION_SEEDS = [
    { sourceNo: '12a', label: 'Faculty Housing (Type II–III)' },
    { sourceNo: '12b', label: 'Faculty Housing (Type IV)' },
    { sourceNo: '12c', label: 'Faculty Housing (Type V–VI)' },
];

const OTHER_LOCATION_SEEDS = [
    ['1', 'Auditorium / Convention Center'],
    ['2', 'Administration'],
    ['4', 'Library'],
    ['5', 'Library (Future)'],
    ['6', 'Meditation Pavilion'],
    ['7', 'Connecting Corridor (Faculty)'],
    ['8.1', 'Student Housing (Boys)'],
    ['8.2', 'Student Housing (Girls)'],
    ['9', 'Dining'],
    ['10', 'Student Centre'],
    ['11', 'Sports Centre'],
    ['11a', 'Pavilion cum Change Room (Hockey)'],
    ['11b', 'Pavilion cum Change Room (Football)'],
    ['11c', 'Pavilion cum Change Room (Cricket)'],
    ['13', 'Married Research Scholar Hostel'],
    ['14', 'International Centre'],
    ['15', 'VC Bungalow'],
    ['16', 'Pump House'],
    ['17', 'Main Receiving Station'],
    ['17a-1', 'ESS-1 (Utility-1)'],
    ['17a-2', 'ESS-4 (Utility-4)'],
    ['17b-1', 'ESS-7 (Utility-2)'],
    ['17b-2', 'ESS-3 (Utility-3)'],
    ['17c-1', 'ESS-6 incl. MRS-2'],
    ['17c-2', 'ESS-5'],
    ['17c-2a', 'ESS-2 (in Auditorium)'],
    ['17c-3', 'ESS-8'],
    ['17c-4', 'ESS-9'],
    ['18', 'AC Plant'],
    ['19', 'Utility Buildings'],
    ['20', 'Main Gate'],
    ['21', 'Sports Field'],
    ['22', 'Sports Stadium'],
    ['23', 'Indoor Stadium'],
    ['24', 'Swimming Pool'],
    ['25', 'Central Corridor'],
    ['26', 'Open Air Theatre'],
    ['27', 'Pathway'],
    ['28', 'Site Office'],
    ['29', 'Foreign Institutional Area'],
    ['30', 'Parking'],
    ['31', 'Overhead Tank'],
    ['32', 'Telephone Exchange'],
    ['33', 'Guest House'],
    ['33a', 'Guest House (Future Expansion)'],
    ['34', 'Amenities, Shops, Bank / ATM / Post Office'],
    ['35', 'Dispensary'],
    ['36', 'Dormitory'],
    ['37', 'Faculty Club'],
    ['38', 'Green House'],
    ['39', 'Animal House'],
    ['40', 'Workshop'],
    ['41', 'Reception Block'],
];

const TRADES = { CIVIL: 'civil', ELECTRICAL: 'electrical' };

// Chosen by the faculty member instead of a priority. `legacyPriority` keeps the
// old priority column meaningful for the admin export and legacy screens.
const SEVERITY_LEVELS = {
    minor: { label: 'Minor Repair', legacyPriority: 'Low' },
    major: { label: 'Major Repair', legacyPriority: 'High' },
};

const ISSUE_TYPE_SEEDS = [
    { key: 'civil', label: 'Civil', trade: TRADES.CIVIL },
    { key: 'carpentry', label: 'Carpentry', trade: TRADES.CIVIL },
    { key: 'plumbing', label: 'Plumbing', trade: TRADES.CIVIL },
    { key: 'water', label: 'Water', trade: TRADES.CIVIL },
    { key: 'electrical', label: 'Electrical', trade: TRADES.ELECTRICAL },
    { key: 'lift_hvac', label: 'Lift / HVAC', trade: TRADES.ELECTRICAL },
    { key: 'cleanliness', label: 'Cleanliness', trade: TRADES.CIVIL },
    { key: 'other', label: 'Other', trade: TRADES.CIVIL },
];

/*
 * Temporary test accounts. The .test domain can never receive mail, so the
 * mailer skips it and (outside production) the login OTP is written to the
 * server log instead. Replace these with real accounts before go-live.
 */
const TEST_MAIL_DOMAIN = 'gbu-maintenance.test';

const STAFF_SEEDS = [
    { key: 'je_civil_residence', name: 'JE Civil 1 (Residence)', username: 'je_civil1', role: 'je', trade: TRADES.CIVIL, designation: 'Junior Engineer (Civil) - Residence', password: 'JeCivil1@123' },
    { key: 'je_civil_hostel', name: 'JE Civil 2 (Hostel)', username: 'je_civil2', role: 'je', trade: TRADES.CIVIL, designation: 'Junior Engineer (Civil) - Hostel', password: 'JeCivil2@123' },
    { key: 'je_civil_school', name: 'JE Civil 3 (School & Others)', username: 'je_civil3', role: 'je', trade: TRADES.CIVIL, designation: 'Junior Engineer (Civil) - School & Campus', password: 'JeCivil3@123' },
    { key: 'je_electrical', name: 'JE Electrical 1 (General)', username: 'je_elec1', role: 'je', trade: TRADES.ELECTRICAL, designation: 'Junior Engineer (Electrical)', password: 'JeElec1@123' },
    { key: 'je_lift_hvac', name: 'JE Electrical 2 (Lift / HVAC)', username: 'je_elec2', role: 'je', trade: TRADES.ELECTRICAL, designation: 'Junior Engineer (Electrical) - Lift / HVAC', password: 'JeElec2@123' },
    { key: 'vendor_civil_1', name: 'Civil Vendor 1', username: 'vendor_civil1', role: 'vendor', trade: TRADES.CIVIL, company: 'Sample Civil Works Pvt. Ltd.', password: 'VendorC1@123' },
    { key: 'vendor_civil_2', name: 'Civil Vendor 2', username: 'vendor_civil2', role: 'vendor', trade: TRADES.CIVIL, company: 'Sample Builders & Co.', password: 'VendorC2@123' },
    { key: 'vendor_electrical_1', name: 'Electrical Vendor 1', username: 'vendor_elec1', role: 'vendor', trade: TRADES.ELECTRICAL, company: 'Sample Electricals', password: 'VendorE1@123' },
    { key: 'vendor_electrical_2', name: 'Electrical Vendor 2', username: 'vendor_elec2', role: 'vendor', trade: TRADES.ELECTRICAL, company: 'Sample Lift & HVAC Services', password: 'VendorE2@123' },
    { key: 'senior_officer_1', name: 'Senior Officer 1', username: 'sr_officer1', role: 'senior_officer', designation: 'Senior Officer', password: 'SrOfficer1@123' },
    { key: 'senior_officer_2', name: 'Senior Officer 2', username: 'sr_officer2', role: 'senior_officer', designation: 'Senior Officer', password: 'SrOfficer2@123' },
    { key: 'senior_officer_3', name: 'Senior Officer 3', username: 'sr_officer3', role: 'senior_officer', designation: 'Senior Officer', password: 'SrOfficer3@123' },
    // Email kept from the original `director_works` username: seeding matches existing accounts by email.
    { key: 'director', name: 'Director (Works)', username: 'director', email: `director.works@${TEST_MAIL_DOMAIN}`, role: 'director', designation: 'Director', password: 'Director@123' },
].map((seed) => ({ ...seed, email: seed.email || `${seed.username.replace(/_/g, '.')}@${TEST_MAIL_DOMAIN}` }));

// Most specific matching rule wins (see model.findRoute).
const ROUTING_RULE_SEEDS = [
    { key: 'lift_hvac_anywhere', description: 'Lift / HVAC complaints from any location', issueType: 'lift_hvac', je: 'je_lift_hvac' },
    { key: 'electrical_anywhere', description: 'All electrical complaints from any location', issueType: 'electrical', je: 'je_electrical' },
    { key: 'civil_residence', description: 'Civil-side complaints from faculty residences', locationCategory: 'residence', trade: TRADES.CIVIL, je: 'je_civil_residence' },
    { key: 'civil_hostel', description: 'Civil-side complaints from hostels', locationCategory: 'hostel', trade: TRADES.CIVIL, je: 'je_civil_hostel' },
    { key: 'civil_school', description: 'Civil-side complaints from schools', locationCategory: 'school', trade: TRADES.CIVIL, je: 'je_civil_school' },
    { key: 'civil_other', description: 'Civil-side complaints from other campus facilities', locationCategory: 'other', trade: TRADES.CIVIL, je: 'je_civil_school' },
];

module.exports = {
    WORKFLOW,
    TICKET_PREFIX,
    FACULTY_CATEGORY,
    SITE_VISIT_WORKING_DAYS,
    DESCRIPTION_MAX_WORDS,
    STAGES,
    STAGE_LABELS,
    ALL_STAGES,
    OPEN_STAGES,
    statusForStage,
    LOCATION_CATEGORY_SEEDS,
    SCHOOL_LOCATION_SEEDS,
    RESIDENCE_LOCATION_SEEDS,
    OTHER_LOCATION_SEEDS,
    TRADES,
    SEVERITY_LEVELS,
    ISSUE_TYPE_SEEDS,
    TEST_MAIL_DOMAIN,
    STAFF_SEEDS,
    ROUTING_RULE_SEEDS,
};
