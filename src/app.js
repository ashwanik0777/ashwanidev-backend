const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const { randomUUID } = require("crypto");
const path = require("path");
const env = require("./config/env");
const apiRoutes = require("./routes");
const recruitmentsRoutes = require("./modules/recruitments");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");
const { apiRateLimiter } = require("./middleware/rateLimit");

const app = express();
// Requests arrive through one reverse proxy (Traefik). Trusting that single hop
// makes req.ip the visitor's address, so rate limits count each visitor
// separately instead of putting everyone into the proxy's one shared bucket.
app.set("trust proxy", 1);
// The admin portal saves an entire school's CMS content (notices, news, events,
// newsletters and the event gallery) as one JSON document, which quickly exceeds
// the 100kb express default and used to fail the save with a bare 413.
app.use(express.json({ limit: env.jsonBodyLimit }));
app.disable("x-powered-by");

// Old grievance attachments under uploads/grievances stay private; current ones
// are served only by the access-checked maintenance files endpoint.
app.use(`${env.uploadBaseUrl}/grievances`, (req, res) => res.status(404).end());

// Serve uploaded files BEFORE helmet — uploaded assets are public and don't need
// security headers. Helmet's Cross-Origin-Resource-Policy: same-origin would
// block cross-origin image loading (frontend and backend on different ports).
app.use(
  env.uploadBaseUrl,
  express.static(path.resolve(env.uploadStoragePath), {
    maxAge: "365d",
    immutable: true,
    etag: true,
    lastModified: true,
  })
);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || env.nodeEnv === "development") {
        return callback(null, true);
      }
      const allowedOrigins = env.corsOrigin.split(",").map((item) => item.trim());
      if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
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
