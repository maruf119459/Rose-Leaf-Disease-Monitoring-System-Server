const User = require("../models/User");

/**
 * Authenticates requests coming from the ESP32 device.
 * The ESP32 sends its device token in the "X-Device-Token" header on every
 * sensor-data POST. This is far cheaper for a microcontroller than doing
 * full Firebase authentication, while still ensuring each reading is
 * attributed to the correct user's account (1 user = 1 device).
 */
async function deviceAuth(req, res, next) {
  try {
    const token = req.header("X-Device-Token");
    if (!token) {
      return res.status(401).json({ status: "error", message: "Missing X-Device-Token header" });
    }

    const user = await User.findOne({ deviceToken: token }).select("_id").lean();
    if (!user) {
      return res.status(401).json({ status: "error", message: "Invalid device token" });
    }

    req.userId = user._id;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = deviceAuth;
