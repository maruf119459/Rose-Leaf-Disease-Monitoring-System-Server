const User = require("../models/User");

// Called once, immediately after Firebase signup completes on the app.
// Creates the MongoDB profile document and issues the deviceToken that the
// user will later flash into their ESP32 firmware.
async function createProfile(req, res, next) {
  try {
    const { fullName, email, phone, latitude, longitude } = req.body;

    if (!fullName || !email || !phone || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ status: "error", message: "Missing required profile fields" });
    }

    const existing = await User.findOne({ uid: req.uid });
    if (existing) {
      return res.status(409).json({ status: "error", message: "Profile already exists for this account" });
    }

    const user = await User.create({
      uid: req.uid,
      fullName,
      email,
      phone,
      latitude: Math.trunc(latitude),
      longitude: Math.trunc(longitude),
    });

    res.status(201).json({
      status: "success",
      data: {
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        latitude: user.latitude,
        longitude: user.longitude,
        deviceToken: user.deviceToken, // shown once at signup so the user can flash it to their ESP32
      },
    });
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.userId).select("-__v");
    res.json({ status: "success", data: user });
  } catch (err) {
    next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    const { fullName, phone, country } = req.body;
    const update = {};
    if (fullName) update.fullName = fullName;
    if (phone) update.phone = phone;
    if (country) update.country = country;

    const user = await User.findByIdAndUpdate(req.userId, update, { new: true }).select("-__v");
    res.json({ status: "success", data: user });
  } catch (err) {
    next(err);
  }
}

// Lets a user invalidate and re-issue their device token (e.g. if a device
// is lost/replaced) without needing to delete and recreate the account.
async function regenerateDeviceToken(req, res, next) {
  try {
    const { v4: uuidv4 } = require("uuid");
    const user = await User.findByIdAndUpdate(
      req.userId,
      { deviceToken: uuidv4() },
      { new: true }
    ).select("deviceToken");
    res.json({ status: "success", data: { deviceToken: user.deviceToken } });
  } catch (err) {
    next(err);
  }
}

module.exports = { createProfile, getMe, updateMe, regenerateDeviceToken };
