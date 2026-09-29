const admin = require("firebase-admin");

function initFirebaseAdmin() {
  if (admin.apps.length > 0) return admin;

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not set. Paste your Firebase service account JSON into the .env file."
    );
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("[Firebase] Admin SDK initialized");
  return admin;
}

module.exports = initFirebaseAdmin;
