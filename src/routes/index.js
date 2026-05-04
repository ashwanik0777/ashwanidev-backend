const express = require("express");
const authRoutes = require("../modules/auth/auth.routes");
const dashboardRoutes = require("../modules/dashboard/dashboard.routes");
const { successResponse } = require("../utils/response");
const bookingRoutes = require("../modules/booking");
const academicRoutes = require("../modules/academics");
const clubsRoutes = require("../modules/clubs");
const departmentRoutes = require("../modules/departments");
const programRoutes = require("../modules/programs");
const communicationsRoutes = require("../modules/communications");
const tendersRoutes = require("../modules/tenders");
const usersRoutes = require("../modules/users");
const facultyRoutes = require("../modules/faculty");
const router = express.Router();
const v1Router = express.Router();

router.get("/health", (req, res) => {
  return successResponse(res, "Service is healthy", {
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);

router.use("/bookings", bookingRoutes);
router.use("/academics", academicRoutes);
router.use("/", clubsRoutes);

// Versioned API surface used by frontend integration.
v1Router.use("/", academicRoutes);
v1Router.use("/", clubsRoutes);
v1Router.use("/", departmentRoutes);
v1Router.use("/", programRoutes);
v1Router.use("/", communicationsRoutes);
v1Router.use("/", tendersRoutes);
v1Router.use("/", facultyRoutes);
v1Router.use("/", usersRoutes);
router.use("/v1", v1Router);
module.exports = router;
