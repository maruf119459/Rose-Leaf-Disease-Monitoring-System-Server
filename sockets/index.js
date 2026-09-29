const admin = require("firebase-admin");
const User = require("../models/User");

/**
 * Wires up Socket.IO. The mobile app connects and immediately emits
 * "authenticate" with its Firebase ID token; once verified, the socket is
 * joined to a room scoped to that user's MongoDB _id. The ESP32 itself does
 * NOT use Socket.IO — it only ever makes plain HTTP POST requests (see
 * routes/sensorRoutes.js); the server is what re-broadcasts each new
 * reading to the correct user's room in real time.
 */
function initSocket(io) {
  io.on("connection", (socket) => {
    socket.on("authenticate", async (idToken) => {
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        const user = await User.findOne({ uid: decoded.uid }).select("_id").lean();
        if (!user) {
          socket.emit("authenticate:error", "No profile found for this account");
          return;
        }
        socket.join(`user:${user._id}`);
        socket.emit("authenticate:success");
      } catch (err) {
        socket.emit("authenticate:error", "Invalid or expired login session");
      }
    });

    socket.on("disconnect", () => {
      // Socket.IO automatically removes the socket from any rooms it joined.
    });
  });
}

module.exports = initSocket;
