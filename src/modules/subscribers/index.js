const express = require("express");
const { query } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");

const { sendMail } = require("../../utils/mailer");
const { buildNewsletterSubscriptionEmail } = require("../../utils/mailTemplate");

const router = express.Router();

const ensureSubscribersTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      is_active BOOLEAN DEFAULT true,
      subscribed_at TIMESTAMP DEFAULT NOW()
    );
  `);
};

// POST: Public subscribe endpoint
router.post("/subscribers", async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse(res, "Validation failed", [{ field: "email", message: "A valid email is required" }], 400);
  }

  try {
    await ensureSubscribersTable();
    
    // Check if they are already active before upserting, to avoid re-sending email unnecessarily
    const existing = await query("SELECT id, is_active FROM newsletter_subscribers WHERE email = $1", [email.toLowerCase().trim()]);
    const isNewSubscription = !existing.rows.length || !existing.rows[0].is_active;

    // Use upsert to handle re-subscriptions
    const result = await query(`
      INSERT INTO newsletter_subscribers (email, is_active, subscribed_at)
      VALUES ($1, true, NOW())
      ON CONFLICT (email) DO UPDATE SET is_active = true, subscribed_at = NOW()
      RETURNING id, email, is_active, subscribed_at
    `, [email.toLowerCase().trim()]);

    // Fire & forget the email sending so it doesn't slow down the response
    if (isNewSubscription) {
      sendMail({
        to: email.toLowerCase().trim(),
        subject: "Welcome to GBU Newsletter",
        html: buildNewsletterSubscriptionEmail(email.toLowerCase().trim()),
      }).catch(err => {
        console.error("Failed to send newsletter welcome email:", err.message);
      });
    }

    return successResponse(res, "Successfully subscribed to newsletter", result.rows[0], 201);
  } catch (error) {
    return errorResponse(res, "Subscription failed", [{ field: "server", message: error.message }], 500);
  }
});

// GET: Admin list subscribers
router.get("/admin/subscribers", authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    await ensureSubscribersTable();
    const result = await query(`
      SELECT id, email, is_active, subscribed_at 
      FROM newsletter_subscribers 
      ORDER BY subscribed_at DESC
    `);
    return successResponse(res, "Subscribers fetched successfully", result.rows);
  } catch (error) {
    return errorResponse(res, "Failed to fetch subscribers", [{ field: "server", message: error.message }], 500);
  }
});

// DELETE: Admin delete subscriber
router.delete("/admin/subscribers/:id", authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    await ensureSubscribersTable();
    const result = await query(`DELETE FROM newsletter_subscribers WHERE id = $1 RETURNING id`, [req.params.id]);
    if (result.rowCount === 0) return errorResponse(res, "Subscriber not found", [], 404);
    return successResponse(res, "Subscriber removed successfully");
  } catch (error) {
    return errorResponse(res, "Failed to remove subscriber", [{ field: "server", message: error.message }], 500);
  }
});

// PUT: Admin toggle active status
router.put("/admin/subscribers/:id/toggle", authenticate, authorize(ROLES.SUPER_ADMIN), async (req, res) => {
  try {
    await ensureSubscribersTable();
    const result = await query(`
      UPDATE newsletter_subscribers 
      SET is_active = NOT is_active 
      WHERE id = $1 
      RETURNING id, email, is_active, subscribed_at
    `, [req.params.id]);
    
    if (result.rowCount === 0) return errorResponse(res, "Subscriber not found", [], 404);
    return successResponse(res, "Subscriber status toggled", result.rows[0]);
  } catch (error) {
    return errorResponse(res, "Failed to toggle status", [{ field: "server", message: error.message }], 500);
  }
});

module.exports = router;
