const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const { userAuth } = require("../middleware/userAuth");
const detectionController = require("../controllers/detectionController");

// Images stay in memory only long enough to run inference — never written
// to disk, which keeps this stateless and safe to run on multiple Render
// instances at once.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

// Inference is CPU-heavy; a tighter rate limit on this specific route
// protects the inference worker pool from being overwhelmed, independent
// of the more generous global API rate limit in server.js.
const detectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12, // 12 detection requests per user-IP per minute
  standardHeaders: true,
  legacyHeaders: false,
});

router.post("/", userAuth, detectLimiter, upload.single("image"), detectionController.detectDisease);
router.patch("/susceptibility", userAuth, detectionController.tagSusceptibilityWindow);

module.exports = router;
