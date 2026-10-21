
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const User = require("../models/User");

const router = express.Router();

// Email configuration
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

// User Signup
router.post("/signup", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username?.trim() || !email?.trim() || !password) {
      return res.status(400).json({
        message: "Username, email and password are required",
      });
    }

    if (username.trim().length < 3) {
      return res.status(400).json({
        message: "Username must be at least 3 characters",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({
      $or: [
        { username: cleanUsername },
        { email: cleanEmail },
      ],
    });

    if (existingUser) {
      return res.status(409).json({
        message: "Username or email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      username: cleanUsername,
      email: cleanEmail,
      password: hashedPassword,
    });

    return res.status(201).json({
      message: "Account created successfully",
      user: {
        id: user._id,
        _id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Username or email already exists",
      });
    }

    console.error("Signup error:", error.message);
    return res.status(500).json({
      message: "Server error during signup",
    });
  }
});

// User Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const user = await User.findOne({
      email: email.trim().toLowerCase(),
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is missing from .env");
      return res.status(500).json({
        message: "Authentication configuration error",
      });
    }

    const token = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        _id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({
      message: "Server error during login",
    });
  }
});

// Forgot Password: email a secure, time-limited reset link
router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const user = await User.findOne({ email });

    // Same response whether or not the account exists.
    const genericMessage =
      "If an account exists for this email, reset instructions will be sent.";

    if (!user) {
      return res.json({ message: genericMessage });
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
      console.error("Email configuration is missing from .env");
      return res.status(503).json({
        message: "Password reset email is not configured yet.",
      });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");

    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);

    await user.save();

    const clientUrl = (
      process.env.CLIENT_URL || "http://localhost:5173"
    ).replace(/\/+$/, "");

    const resetUrl =
      `${clientUrl}/reset-password?token=${rawToken}`;

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: "ChatSpace Password Reset",
        text: [
          `Hi ${user.username},`,
          "",
          "We received a request to reset your ChatSpace password.",
          `Open this link within 15 minutes: ${resetUrl}`,
          "",
          "If you did not request this, you can ignore this email.",
        ].join("\n"),
        html: `
          <p>Hi ${user.username},</p>
          <p>We received a request to reset your ChatSpace password.</p>
          <p>
            <a href="${resetUrl}">Reset my password</a>
          </p>
          <p>This link expires in 15 minutes.</p>
          <p>If you did not request this, you can ignore this email.</p>
        `,
      });
    } catch (mailError) {
      // Invalidate the token if email delivery fails.
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      console.error("Reset email failed:", mailError.message);

      return res.status(503).json({
        message: "Could not send reset email. Check the email configuration.",
      });
    }

    return res.json({ message: genericMessage });
  } catch (error) {
    console.error("Forgot password error:", error.message);
    return res.status(500).json({
      message: "Unable to process password reset request",
    });
  }
});

// Reset Password: validate token and save the new password
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        message: "Reset token and new password are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        message: "Reset link is invalid or expired. Request a new one.",
      });
    }

    user.password = await bcrypt.hash(password, 12);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    return res.json({
      message: "Password reset successful. You can now log in.",
    });
  } catch (error) {
    console.error("Reset password error:", error.message);
    return res.status(500).json({
      message: "Unable to reset password",
    });
  }
});

module.exports = router;
