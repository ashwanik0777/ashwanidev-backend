const express = require("express");
const {
  facultyLoginHandler,
  teacherLoginHandler,
  schoolLoginHandler,
  adminLoginHandler,
  studentLoginHandler,
  maintenanceLoginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  forgotPasswordRequestHandler,
  forgotPasswordVerifyHandler,
  verifyLoginOtpHandler,
} = require("./auth.controller");
const { authenticate } = require("../../middleware/auth");
const { loginRateLimiter, sessionRateLimiter, otpRequestRateLimiter } = require("../../middleware/rateLimit");

const router = express.Router();

router.post("/login/verify-otp", loginRateLimiter, verifyLoginOtpHandler);
router.post("/login/faculty", loginRateLimiter, facultyLoginHandler);
router.post("/login/teacher", loginRateLimiter, teacherLoginHandler);
router.post("/login/school", loginRateLimiter, schoolLoginHandler);
router.post("/login/admin", loginRateLimiter, adminLoginHandler);
router.post("/login/student", loginRateLimiter, studentLoginHandler);
router.post("/login/maintenance", loginRateLimiter, maintenanceLoginHandler);
router.post("/refresh", sessionRateLimiter, refreshHandler);
router.post("/logout", sessionRateLimiter, logoutHandler);
router.post("/forgot-password/request-otp", otpRequestRateLimiter, forgotPasswordRequestHandler);
router.post("/forgot-password/verify-otp", loginRateLimiter, forgotPasswordVerifyHandler);
router.get("/me", authenticate, meHandler);

module.exports = router;
