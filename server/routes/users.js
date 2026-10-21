
const express = require("express");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Get all users except the logged-in user
router.get("/", authMiddleware, async (req, res) => {
  try {
    const users = await User.find({
      _id: { $ne: req.userId },
    })
      .select("_id username profilePic")
      .sort({ username: 1 });

    res.json(users);
  } catch (error) {
    console.error("Get users error:", error.message);
    res.status(500).json({
      message: "Unable to fetch users",
    });
  }
});

module.exports = router;
