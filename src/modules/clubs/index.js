const express = require("express");
const { query } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");

const router = express.Router();
const parseClubId = (value) => {
	const normalized = String(value || "").trim();
	if (!/^\d+$/.test(normalized)) {
		return null;
	}
	const parsed = Number.parseInt(normalized, 10);
	return parsed > 0 ? parsed : null;
};

const toAchievements = (value) => {
	if (!value) {
		return [];
	}
	if (Array.isArray(value)) {
		return value.map((item) => String(item).trim()).filter(Boolean);
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) {
			return [];
		}
		if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
			try {
				const parsed = JSON.parse(trimmed);
				return Array.isArray(parsed)
					? parsed.map((item) => String(item).trim()).filter(Boolean)
					: [];
			} catch (error) {
				return [];
			}
		}
		return trimmed
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return [];
};

const mapClub = (row) => ({
	id: row.id,
	name: row.name,
	tagline: row.tagline,
	category: row.category,
	logo: row.logo,
	banner: row.banner,
	memberCount: Number(row.member_count || 0),
	description: row.description,
	achievements: toAchievements(row.achievements),
	createdAt: row.created_at,
});

router.get("/clubs", async (_req, res) => {
	try {
		const clubsResult = await query(
			`SELECT id, name, tagline, category, logo, banner, member_count, description, achievements, created_at FROM clubs ORDER BY created_at DESC, id DESC`,
		);
		return successResponse(
			res,
			"Clubs fetched successfully",
			clubsResult.rows.map(mapClub),
		);
	} catch (error) {
		return errorResponse(
			res,
			"Failed to fetch clubs",
			[{ field: "clubs", message: error.message }],
			500,
		);
	}
});

router.get("/clubs/:id", async (req, res) => {
	const id = parseClubId(req.params.id);
	if (!id) {
		return errorResponse(
			res,
			"Validation failed",
			[{ field: "id", message: "Club id must be a positive integer" }],
			400,
		);
	}
	try {
		const clubResult = await query(
			`SELECT id, name, tagline, category, logo, banner, member_count, description, achievements, created_at FROM clubs WHERE id = $1 LIMIT 1`,
			[id]
		);
		if (!clubResult.rows.length) {
			return errorResponse(
				res,
				"Club not found",
				[{ field: "id", message: "No club found for this id" }],
				404,
			);
		}
		return successResponse(
			res,
			"Club fetched successfully",
			mapClub(clubResult.rows[0]),
		);
	} catch (error) {
		return errorResponse(
			res,
			"Failed to fetch club",
			[{ field: "club", message: error.message }],
			500,
		);
	}
});

module.exports = router;
