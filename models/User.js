const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const userSchema = new mongoose.Schema(
  {
    // Firebase UID — the unique identifier used across the whole project
    uid: { type: String, required: true, unique: true, index: true },

    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },

    // Captured via the map button during signup (integer values, as specified)
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    country: { type: String, default: null }, // resolved from lat/long

    // Shared-secret token the single ESP32 device for this user includes on
    // every sensor-data request, so the server knows which user's account
    // the reading belongs to without requiring the microcontroller to do
    // full Firebase authentication (1 user = 1 device, per project scope).
    deviceToken: { type: String, required: true, unique: true, default: () => uuidv4() },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
