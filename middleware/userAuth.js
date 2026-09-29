const admin = require("firebase-admin");
const User = require("../models/User");

/**
 * Verifies the Firebase ID token only (does NOT require a Mongo profile to
 * already exist). Used on the "create profile" endpoint that runs
 * immediately after Firebase signup, before any MongoDB user document
 * exists yet.
 */
async function verifyFirebaseToken(req, res, next) {
  try {
    const header = req.header("Authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ status: "error", message: "Missing Authorization bearer token" });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    req.firebaseEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ status: "error", message: "Invalid or expired login session" });
  }
}

/**
 * Full authentication for the mobile app: verifies the Firebase ID token
 * AND requires a corresponding MongoDB user profile to already exist.
 * Expects: Authorization: Bearer <Firebase ID token>
 */
async function userAuth(req, res, next) {
  try {
    const header = req.header("Authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ status: "error", message: "Missing Authorization bearer token" });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    const user = await User.findOne({ uid: decoded.uid }).select("_id uid").lean();

    if (!user) {
      return res.status(404).json({ status: "error", message: "No account found for this login" });
    }

    req.uid = decoded.uid;
    req.userId = user._id;
    next();
  } catch (err) {
    return res.status(401).json({ status: "error", message: "Invalid or expired login session" });
  }
}

module.exports = { userAuth, verifyFirebaseToken };
