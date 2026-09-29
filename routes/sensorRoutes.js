const express = require("express");
const router = express.Router();

const deviceAuth = require("../middleware/deviceAuth");
const { userAuth } = require("../middleware/userAuth");
const sensorController = require("../controllers/sensorController");

// ESP32 -> server (device-token authenticated)
router.post("/", deviceAuth, sensorController.ingestSensorData);

// App -> server (Firebase-authenticated)
router.get("/latest", userAuth, sensorController.getLatest);
router.get("/logs/daily", userAuth, sensorController.getDailyLogs);
router.get("/logs/day/:date/eight-hour", userAuth, sensorController.getEightHourLogs);
router.get("/logs/day/:date/block/:blockIndex/raw", userAuth, sensorController.getRawReadingsForBlock);
router.get("/logs/export.csv", userAuth, sensorController.exportCsv);

module.exports = router;
