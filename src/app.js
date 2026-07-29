const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const { randomUUID } = require("crypto");
const env = require("./config/env");
const apiRoutes = require("./routes");
const recruitmentsRoutes = require("./modules/recruitments");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");
const { apiRateLimiter } = require("./middleware/rateLimit");

const app = express();
// The admin portal saves an entire school's CMS content (notices, news, events,
// newsletters and the event gallery) as one JSON document, which quickly exceeds
// the 100kb express default and used to fail the save with a bare 413.
app.use(express.json({ limit: env.jsonBodyLimit }));
app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin.split(",").map((item) => item.trim()),
    credentials: true,
  }),
);
app.use(compression());
app.use(express.urlencoded({ extended: true, limit: env.jsonBodyLimit }));

app.use((req, res, next) => {
  req.requestId = req.headers["x-request-id"] || randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
});

// Keep a direct path for frontend clients requesting /recruitments without /api prefix.
app.use("/", apiRateLimiter, recruitmentsRoutes);
app.use("/api", apiRateLimiter, apiRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
