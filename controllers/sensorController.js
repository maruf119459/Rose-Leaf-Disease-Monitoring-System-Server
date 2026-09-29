const SensorData = require("../models/SensorData");

// ---------------------------------------------------------------
// Ingestion (called by the ESP32 every 5 minutes)
// ---------------------------------------------------------------
async function ingestSensorData(req, res, next) {
  try {
    const {
      temperature, humidity, soilMoistureAnalog, soilMoistureDigital,
      lightIntensity, rainDetected, rainAnalog,
    } = req.body;

    const requiredFields = {
      temperature, humidity, soilMoistureAnalog, soilMoistureDigital, lightIntensity, rainDetected, rainAnalog,
    };
    for (const [key, val] of Object.entries(requiredFields)) {
      if (val === undefined || val === null) {
        return res.status(400).json({ status: "error", message: `Missing field: ${key}` });
      }
    }

    const reading = await SensorData.create({
      userId: req.userId,
      temperature, humidity, soilMoistureAnalog, soilMoistureDigital,
      lightIntensity, rainDetected, rainAnalog,
      recordedAt: new Date(),
    });

    // Push to the app in real time (Home page live sensor boxes).
    const io = req.app.get("io");
    io.to(`user:${req.userId}`).emit("sensor:update", {
      temperature: reading.temperature,
      humidity: reading.humidity,
      soilMoistureAnalog: reading.soilMoistureAnalog,
      soilMoistureDigital: reading.soilMoistureDigital,
      lightIntensity: reading.lightIntensity,
      rainDetected: reading.rainDetected,
      rainAnalog: reading.rainAnalog,
      recordedAt: reading.recordedAt,
    });

    res.status(201).json({ status: "success" });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// Latest reading (app uses this on cold start / reconnect, and to
// know what to show while offline before falling back to its own cache)
// ---------------------------------------------------------------
async function getLatest(req, res, next) {
  try {
    const latest = await SensorData.findOne({ userId: req.userId }).sort({ recordedAt: -1 }).lean();
    res.json({ status: "success", data: latest || null });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// Daily log: one averaged row per day, plus which disease(s) were tagged
// ---------------------------------------------------------------
async function getDailyLogs(req, res, next) {
  try {
    const { from, to } = req.query;
    const match = { userId: req.userId };
    if (from || to) {
      match.recordedAt = {};
      if (from) match.recordedAt.$gte = new Date(from);
      if (to) match.recordedAt.$lte = new Date(to);
    }

    const rows = await SensorData.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateTrunc: { date: "$recordedAt", unit: "day" } },
          avgTemperature: { $avg: "$temperature" },
          avgHumidity: { $avg: "$humidity" },
          avgSoilMoistureAnalog: { $avg: "$soilMoistureAnalog" },
          avgLightIntensity: { $avg: "$lightIntensity" },
          rainEvents: { $sum: "$rainDetected" },
          diseases: { $push: "$diseases" },
          sampleCount: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
    ]);

    const data = rows.map((r) => ({
      date: r._id,
      avgTemperature: round(r.avgTemperature),
      avgHumidity: round(r.avgHumidity),
      avgSoilMoistureAnalog: round(r.avgSoilMoistureAnalog),
      avgLightIntensity: round(r.avgLightIntensity),
      rainEvents: r.rainEvents,
      diseases: flattenDiseases(r.diseases),
      sampleCount: r.sampleCount,
    }));

    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// 8-hour drill-down: 3 rows (00-08, 08-16, 16-24) for a single given day
// ---------------------------------------------------------------
async function getEightHourLogs(req, res, next) {
  try {
    const { date } = req.params; // YYYY-MM-DD
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const rows = await SensorData.aggregate([
      { $match: { userId: req.userId, recordedAt: { $gte: dayStart, $lte: dayEnd } } },
      {
        $addFields: {
          block: { $floor: { $divide: [{ $hour: "$recordedAt" }, 8] } }, // 0, 1, or 2
        },
      },
      {
        $group: {
          _id: "$block",
          avgTemperature: { $avg: "$temperature" },
          avgHumidity: { $avg: "$humidity" },
          avgSoilMoistureAnalog: { $avg: "$soilMoistureAnalog" },
          avgLightIntensity: { $avg: "$lightIntensity" },
          rainEvents: { $sum: "$rainDetected" },
          diseases: { $push: "$diseases" },
          sampleCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const blockLabels = ["00:00 - 08:00", "08:00 - 16:00", "16:00 - 24:00"];
    const data = rows.map((r) => ({
      block: r._id,
      label: blockLabels[r._id],
      avgTemperature: round(r.avgTemperature),
      avgHumidity: round(r.avgHumidity),
      avgSoilMoistureAnalog: round(r.avgSoilMoistureAnalog),
      avgLightIntensity: round(r.avgLightIntensity),
      rainEvents: r.rainEvents,
      diseases: flattenDiseases(r.diseases),
      sampleCount: r.sampleCount,
    }));

    res.json({ status: "success", data });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// Raw drill-down: every 5-minute reading inside one 8-hour block
// ---------------------------------------------------------------
async function getRawReadingsForBlock(req, res, next) {
  try {
    const { date, blockIndex } = req.params; // blockIndex: 0, 1, or 2
    const startHour = Number(blockIndex) * 8;
    const endHour = startHour + 8;

    const blockStart = new Date(`${date}T00:00:00.000Z`);
    blockStart.setUTCHours(startHour, 0, 0, 0);
    const blockEnd = new Date(`${date}T00:00:00.000Z`);
    blockEnd.setUTCHours(endHour, 0, 0, 0);

    const readings = await SensorData.find({
      userId: req.userId,
      recordedAt: { $gte: blockStart, $lt: blockEnd },
    })
      .sort({ recordedAt: 1 })
      .lean();

    res.json({ status: "success", data: readings });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// CSV export: raw 5-minute data for a date range, or ALL data if no
// range is given, always including the disease name per row.
// ---------------------------------------------------------------
async function exportCsv(req, res, next) {
  try {
    const { from, to } = req.query;
    const match = { userId: req.userId };
    if (from || to) {
      match.recordedAt = {};
      if (from) match.recordedAt.$gte = new Date(from);
      if (to) match.recordedAt.$lte = new Date(to);
    }

    const cursor = SensorData.find(match).sort({ recordedAt: 1 }).lean().cursor();

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=sensor_data_export.csv");

    const header =
      "recordedAt,temperature,humidity,soilMoistureAnalog,soilMoistureDigital,lightIntensity,rainDetected,rainAnalog,diseases\n";
    res.write(header);

    // Streamed row-by-row so exporting a very large history doesn't load
    // the entire dataset into memory at once (important under load / for
    // users with a long history of 5-minute readings).
    for await (const doc of cursor) {
      const row = [
        doc.recordedAt.toISOString(),
        doc.temperature,
        doc.humidity,
        doc.soilMoistureAnalog,
        doc.soilMoistureDigital,
        doc.lightIntensity,
        doc.rainDetected,
        doc.rainAnalog,
        `"${(doc.diseases || ["N/A"]).join("; ")}"`,
      ].join(",");
      res.write(row + "\n");
    }

    res.end();
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------
// helpers
// ---------------------------------------------------------------
function round(n) {
  return typeof n === "number" ? Math.round(n * 100) / 100 : n;
}

function flattenDiseases(arraysOfArrays) {
  const set = new Set();
  arraysOfArrays.flat().forEach((d) => set.add(d));
  if (set.size > 1) set.delete("N/A");
  return Array.from(set);
}

module.exports = {
  ingestSensorData,
  getLatest,
  getDailyLogs,
  getEightHourLogs,
  getRawReadingsForBlock,
  exportCsv,
};
