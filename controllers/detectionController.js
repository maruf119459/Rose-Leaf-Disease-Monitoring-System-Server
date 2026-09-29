const SensorData = require("../models/SensorData");

// POST /api/detect  (multipart form-data, field name: "image")
async function detectDisease(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ status: "error", message: "No image file uploaded (field name: image)" });
    }

    const pool = req.app.get("inferencePool");

    // Convert the multer memory Buffer into a transferable ArrayBuffer for
    // the worker thread (see modelWorkerPool.js).
    const arrayBuffer = req.file.buffer.buffer.slice(
      req.file.buffer.byteOffset,
      req.file.buffer.byteOffset + req.file.buffer.byteLength
    );

    const result = await pool.predict(arrayBuffer);

    res.json({
      status: "success",
      data: {
        disease: result.label,
        confidence: result.confidence,
        allScores: result.allScores,
      },
    });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/detect/susceptibility
// Body: { disease: "Black_Spot", days: 5 }
// Retroactively tags the last `days` days of this user's sensor readings
// with the detected disease name. Multiple diseases can co-tag the same
// reading, so "N/A" is removed and the new disease is added, rather than
// the array being overwritten.
async function tagSusceptibilityWindow(req, res, next) {
  try {
    const { disease, days } = req.body;

    if (!disease || !days || days < 1) {
      return res.status(400).json({ status: "error", message: "disease and a positive integer days are required" });
    }

    if (disease === "Healthy") {
      // Per the app design, a Healthy result does not prompt for a
      // susceptibility window — existing readings simply stay "N/A".
      return res.json({ status: "success", message: "No tagging needed for a Healthy result", matched: 0 });
    }

    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - Number(days));

    const result = await SensorData.updateMany(
      { userId: req.userId, recordedAt: { $gte: windowStart } },
      [
        {
          $set: {
            diseases: {
              $setUnion: [
                { $filter: { input: "$diseases", as: "d", cond: { $ne: ["$$d", "N/A"] } } },
                [disease],
              ],
            },
          },
        },
      ]
    );

    res.json({ status: "success", matched: result.matchedCount, modified: result.modifiedCount });
  } catch (err) {
    next(err);
  }
}

module.exports = { detectDisease, tagSusceptibilityWindow };
