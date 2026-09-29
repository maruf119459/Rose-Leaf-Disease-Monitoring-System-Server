const express = require("express");
const router = express.Router();

const { userAuth, verifyFirebaseToken } = require("../middleware/userAuth");
const userController = require("../controllers/userController");

router.post("/", verifyFirebaseToken, userController.createProfile); // after Firebase signup
router.get("/me", userAuth, userController.getMe);
router.patch("/me", userAuth, userController.updateMe);
router.post("/me/device-token/regenerate", userAuth, userController.regenerateDeviceToken);

module.exports = router;
