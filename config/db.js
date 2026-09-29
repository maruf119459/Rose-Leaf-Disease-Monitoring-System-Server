const mongoose = require("mongoose");

async function connectDB() {
  mongoose.set("strictQuery", true);

  await mongoose.connect(process.env.MONGO_URI, {
    // Connection pooling: allows many concurrent requests (ESP32 devices + app
    // users) to share a pool of reusable DB connections instead of opening a
    // new one per request, which is essential for handling load.
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  console.log("[DB] MongoDB Atlas connected");

  mongoose.connection.on("error", (err) => {
    console.error("[DB] Connection error:", err.message);
  });
  mongoose.connection.on("disconnected", () => {
    console.warn("[DB] Disconnected — mongoose will attempt to reconnect automatically");
  });
}

module.exports = connectDB;
