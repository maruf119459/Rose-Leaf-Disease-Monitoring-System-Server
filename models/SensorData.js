const mongoose = require("mongoose");

const sensorDataSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    temperature: { type: Number, required: true }, // DHT22, °C
    humidity: { type: Number, required: true }, // DHT22, %
    soilMoistureAnalog: { type: Number, required: true }, // raw ADC value
    soilMoistureDigital: { type: Number, required: true }, // 0 or 1 (dry/wet threshold)
    lightIntensity: { type: Number, required: true }, // LDR, raw ADC value
    rainDetected: { type: Number, required: true }, // 0 or 1 from rain module digital pin
    rainAnalog: { type: Number, required: true }, // raw ADC value from rain module

    // "N/A" until a disease is detected and the user sets a susceptibility
    // window (Section: Leaf Disease Detection page). Multiple diseases can
    // co-tag the same reading, so this is an array, not a single string.
    diseases: { type: [String], default: ["N/A"] },

    recordedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

// Compound index: every log/history query filters by user and a date range,
// sorted by time — this index makes those queries fast even as the
// collection grows into millions of documents (one every 5 minutes/device).
sensorDataSchema.index({ userId: 1, recordedAt: -1 });

module.exports = mongoose.model("SensorData", sensorDataSchema);
