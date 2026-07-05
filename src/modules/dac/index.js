const express = require("express");
const { query } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");

const router = express.Router();

// Helper to ensure the table exists
const ensureDacTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS dac_team_members (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(255) NOT NULL,
      department VARCHAR(255) NOT NULL,
      designation VARCHAR(255) NOT NULL,
      image TEXT,
      email VARCHAR(255),
      linkedin VARCHAR(255),
      portfolio VARCHAR(255),
      bio TEXT,
      skills JSONB DEFAULT '[]'::jsonb,
      team_type VARCHAR(50) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Seed default data if table is empty
  const countResult = await query("SELECT COUNT(*) FROM dac_team_members");
  if (parseInt(countResult.rows[0].count, 10) === 0) {
    // Insert Faculty
    await query(`
      INSERT INTO dac_team_members (name, role, department, designation, image, email, team_type, sort_order)
      VALUES 
      ('Prof. Rana Pratap Singh', 'Chief Patron', 'GBU Leadership', 'Vice Chancellor', '/assets/prof.jpeg', 'vc@gbu.ac.in', 'faculty', 0),
      ('Dr. Gaurav Kumar', 'Faculty Lead & Convener', 'School of ICT', 'Assistant Professor', 'https://faculty.gbu.ac.in/uploads/photos/6721e9346dac1_Photo-removebg-preview.png', 'gaurav.kumar@gbu.ac.in', 'faculty', 1),
      ('Dr. Priya Sharma', 'Technical Advisor', 'School of ICT', 'Associate Professor', '', 'priya.sharma@gbu.ac.in', 'faculty', 2),
      ('Dr. Rajesh Singh', 'Research Advisor', 'School of ICT', 'Assistant Professor', '', 'rajesh.singh@gbu.ac.in', 'faculty', 3)
    `);

    // Insert Student (Ashwani Kushwaha)
    await query(`
      INSERT INTO dac_team_members (name, role, department, designation, image, email, linkedin, portfolio, bio, skills, team_type, sort_order)
      VALUES 
      ('Ashwani Kushwaha', 'Lead Full-Stack Developer', 'B.Tech CSE', 'Student Lead, Digital Automation Cell', 
       'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=400&h=400&fit=crop&crop=face', 
       'ashwanik346981@gmail.com', 'https://linkedin.com/in/ashwanik0777', 'https://github.com/ashwanik0777', 
       'Lead architect of the GBU Smart Campus initiative. Specializes in building scalable React applications, robust Express/Node.js backends, and optimized database designs.', 
       '["React", "Node.js", "PostgreSQL", "Tailwind CSS", "Framer Motion"]'::jsonb, 'student', 0)
    `);
  }
};

const resequenceSortOrders = async (teamType) => {
  const result = await query(
    "SELECT id FROM dac_team_members WHERE team_type = $1 ORDER BY sort_order ASC, updated_at DESC, id ASC",
    [teamType]
  );
  for (let i = 0; i < result.rows.length; i++) {
    await query("UPDATE dac_team_members SET sort_order = $1 WHERE id = $2", [i, result.rows[i].id]);
  }
};

const mapTeamMemberRow = (row) => ({
  id: row.id,
  name: row.name,
  role: row.role,
  department: row.department,
  designation: row.designation,
  image: row.image || "",
  email: row.email || "",
  linkedin: row.linkedin || "",
  portfolio: row.portfolio || "",
  bio: row.bio || "",
  skills: typeof row.skills === "string" ? JSON.parse(row.skills) : row.skills || [],
  teamType: row.team_type,
  sortOrder: row.sort_order,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// GET Public/Admin Listing
router.get("/dac/team", async (req, res) => {
  try {
    await ensureDacTable();
    const result = await query(
      `
      SELECT * FROM dac_team_members
      ORDER BY team_type DESC, sort_order ASC, id ASC
      `
    );

    const members = result.rows.map(mapTeamMemberRow);
    const faculty = members.filter((m) => m.teamType === "faculty");
    const student = members.filter((m) => m.teamType === "student");

    return successResponse(res, "DAC team fetched successfully", {
      faculty,
      student,
      all: members,
    });
  } catch (error) {
    return errorResponse(
      res,
      "Failed to fetch DAC team",
      [{ field: "dac", message: error.message }],
      500
    );
  }
});

// POST Add Member (Admin only)
router.post("/dac/team", authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    await ensureDacTable();
    const {
      name,
      role,
      department,
      designation,
      image,
      email,
      linkedin,
      portfolio,
      bio,
      skills,
      teamType,
      sortOrder,
    } = req.body;

    if (!name || !role || !department || !designation || !teamType) {
      return errorResponse(
        res,
        "Missing required fields",
        [{ field: "required", message: "Name, role, department, designation, and teamType are required" }],
        400
      );
    }

    let finalSortOrder = sortOrder;
    if (finalSortOrder === undefined || finalSortOrder === null) {
      const maxResult = await query(
        "SELECT MAX(sort_order) FROM dac_team_members WHERE team_type = $1",
        [teamType]
      );
      const maxOrder = maxResult.rows[0].max;
      finalSortOrder = maxOrder !== null ? maxOrder + 1 : 0;
    }

    const result = await query(
      `
      INSERT INTO dac_team_members 
        (name, role, department, designation, image, email, linkedin, portfolio, bio, skills, team_type, sort_order)
      VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
      `,
      [
        name,
        role,
        department,
        designation,
        image || "",
        email || "",
        linkedin || "",
        portfolio || "",
        bio || "",
        JSON.stringify(skills || []),
        teamType,
        finalSortOrder,
      ]
    );

    await resequenceSortOrders(teamType);
    const updatedRow = await query("SELECT * FROM dac_team_members WHERE id = $1", [result.rows[0].id]);

    return successResponse(
      res,
      "Team member added successfully",
      mapTeamMemberRow(updatedRow.rows[0]),
      201
    );
  } catch (error) {
    return errorResponse(
      res,
      "Failed to add team member",
      [{ field: "dac", message: error.message }],
      500
    );
  }
});

// PUT Update Member (Admin only)
router.put("/dac/team/:id", authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    await ensureDacTable();
    const { id } = req.params;
    const {
      name,
      role,
      department,
      designation,
      image,
      email,
      linkedin,
      portfolio,
      bio,
      skills,
      teamType,
      sortOrder,
      isActive,
    } = req.body;

    const checkExist = await query("SELECT * FROM dac_team_members WHERE id = $1", [id]);
    if (checkExist.rows.length === 0) {
      return errorResponse(
        res,
        "Team member not found",
        [{ field: "id", message: "No member exists with this ID" }],
        404
      );
    }

    const currentMember = checkExist.rows[0];

    await query(
      `
      UPDATE dac_team_members 
      SET 
        name = COALESCE($1, name),
        role = COALESCE($2, role),
        department = COALESCE($3, department),
        designation = COALESCE($4, designation),
        image = COALESCE($5, image),
        email = COALESCE($6, email),
        linkedin = COALESCE($7, linkedin),
        portfolio = COALESCE($8, portfolio),
        bio = COALESCE($9, bio),
        skills = COALESCE($10, skills),
        team_type = COALESCE($11, team_type),
        sort_order = COALESCE($12, sort_order),
        is_active = COALESCE($13, is_active),
        updated_at = NOW()
      WHERE id = $14
      `,
      [
        name !== undefined ? name : null,
        role !== undefined ? role : null,
        department !== undefined ? department : null,
        designation !== undefined ? designation : null,
        image !== undefined ? image : null,
        email !== undefined ? email : null,
        linkedin !== undefined ? linkedin : null,
        portfolio !== undefined ? portfolio : null,
        bio !== undefined ? bio : null,
        skills !== undefined ? JSON.stringify(skills) : null,
        teamType !== undefined ? teamType : null,
        sortOrder !== undefined ? sortOrder : null,
        isActive !== undefined ? isActive : null,
        id,
      ]
    );

    const oldTeamType = currentMember.team_type;
    const newTeamType = teamType !== undefined ? teamType : oldTeamType;

    await resequenceSortOrders(newTeamType);
    if (oldTeamType !== newTeamType) {
      await resequenceSortOrders(oldTeamType);
    }

    const updatedRow = await query("SELECT * FROM dac_team_members WHERE id = $1", [id]);

    return successResponse(
      res,
      "Team member updated successfully",
      mapTeamMemberRow(updatedRow.rows[0])
    );
  } catch (error) {
    return errorResponse(
      res,
      "Failed to update team member",
      [{ field: "dac", message: error.message }],
      500
    );
  }
});

// DELETE Member (Admin only)
router.delete("/dac/team/:id", authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    await ensureDacTable();
    const { id } = req.params;

    const checkExist = await query("SELECT * FROM dac_team_members WHERE id = $1", [id]);
    if (checkExist.rows.length === 0) {
      return errorResponse(
        res,
        "Team member not found",
        [{ field: "id", message: "No member exists with this ID" }],
        404
      );
    }

    const teamType = checkExist.rows[0].team_type;
    await query("DELETE FROM dac_team_members WHERE id = $1", [id]);
    await resequenceSortOrders(teamType);

    return successResponse(res, "Team member deleted successfully", { id });
  } catch (error) {
    return errorResponse(
      res,
      "Failed to delete team member",
      [{ field: "dac", message: error.message }],
      500
    );
  }
});

module.exports = router;
