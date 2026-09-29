require("dotenv").config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const connectDB = require("./config/db");
const initFirebaseAdmin = require("./config/firebaseAdmin");
const initSocket = require("./sockets");
const errorHandler = require("./middleware/errorHandler");
const InferencePool = require("./inference/modelWorkerPool");

const sensorRoutes = require("./routes/sensorRoutes");
const detectionRoutes = require("./routes/detectionRoutes");
const userRoutes = require("./routes/userRoutes");

const PORT = process.env.PORT || 5000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());

async function main() {
  // Order matters: get Firebase, the database, and the ML model ready
  // BEFORE accepting any HTTP traffic, so the very first request a user or
  // the ESP32 makes is served correctly instead of racing an uninitialized
  // dependency.
  initFirebaseAdmin();
  await connectDB();

  const inferencePool = new InferencePool(Number(process.env.INFERENCE_WORKERS) || 2);
  console.log("[Inference] Loading ResNet50 model into worker pool...");
  await inferencePool.init();
  console.log("[Inference] Model ready — server can now accept detection requests");

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : "*" },
  });

  // ---- Load-handling / security middleware ----
  app.set("trust proxy", 1); // Render sits behind a reverse proxy
  app.use(helmet());
  app.use(compression()); // gzip responses — smaller payloads, more requests/sec
  app.use(cors({ origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : "*" }));
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Global API rate limit — protects the whole server from being flooded;
  // the detection route additionally has its own, tighter limit (see
  // routes/detectionRoutes.js) because inference is the most expensive
  // operation this server performs.
  app.use(
    "/api",
    rateLimit({
      windowMs: 60 * 1000,
      max: 300, // generous, since many ESP32 + app requests are legitimate
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  // Make io and the inference pool available to route handlers via
  // req.app.get(...), instead of importing singletons everywhere.
  app.set("io", io);
  app.set("inferencePool", inferencePool);

  app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

  app.use("/api/users", userRoutes);
  app.use("/api/sensors", sensorRoutes);
  app.use("/api/detect", detectionRoutes);

  app.use(errorHandler);

  initSocket(io);

  server.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
  });

  // Graceful shutdown: let in-flight requests finish and close the DB
  // connection cleanly instead of dropping connections abruptly when
  // Render restarts/redeploys the service.
  process.on("SIGTERM", () => {
    console.log("[Server] SIGTERM received, shutting down gracefully...");
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("[Server] Fatal startup error:", err);
  process.exit(1);
});
