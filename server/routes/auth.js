
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const User = require("../models/User");

const router = express.Router();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

const hashValue = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const normalizeEmail = (email) =>
  String(email || "").trim().toLowerCase();

async function sendOtpEmail(email, username, otp) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Your ChatSpace verification code",
    text: `Hi ${username},

Your ChatSpace email verification code is: ${otp}

This code expires in 5 minutes. Do not share it with anyone.

If you did not request this code, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:24px">
        <h2 style="color:#8b5cf6">Welcome to ChatSpace!</h2>
        <p>Hi ${String(username).replace(/[&<>"']/g, "")},</p>
        <p>Use this code to verify your email address:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px;background:#f1f0ff;text-align:center;border-radius:12px">
          ${otp}
        </div>
        <p>This code expires in <b>5 minutes</b>.</p>
        <p>Do not share this code with anyone.</p>
      </div>
    `,
  });
}

function createOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

async function issueOtp(user) {
  const now = Date.now();

  if (
    user.emailOtpLastSentAt &&
    now - new Date(user.emailOtpLastSentAt).getTime() < 60 * 1000
  ) {
    return {
      error: "Please wait 60 seconds before requesting another OTP.",
    };
  }

  const otp = createOtp();

  user.emailOtpHash = hashValue(otp);
  user.emailOtpExpires = new Date(now + 5 * 60 * 1000);
  user.emailOtpAttempts = 0;
  user.emailOtpLastSentAt = new Date(now);

  await user.save();

  try {
    await sendOtpEmail(user.email, user.username, otp);
  } catch (error) {
    console.error("OTP email error:", error.message);
    return {
      error: "Could not send verification email. Please try again later.",
    };
  }

  return { success: true };
}

// SIGNUP: Create an unverified account and send OTP
router.post("/signup", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({
        message: "Username must be between 3 and 30 characters.",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must contain at least 6 characters.",
      });
    }

    const existingEmail = await User.findOne({ email }).select(
      "+emailOtpHash +emailOtpExpires +emailOtpAttempts +emailOtpLastSentAt"
    );

    const existingUsername = await User.findOne({ username });

    if (existingEmail && existingEmail.isEmailVerified !== false) {
      return res.status(409).json({
        message: "This email is already registered. Please log in.",
      });
    }

    if (
      existingUsername &&
      (!existingEmail ||
        String(existingUsername._id) !== String(existingEmail._id))
    ) {
      return res.status(409).json({
        message: "This username is already taken.",
      });
    }

    let user = existingEmail;

    if (user) {
      // Do not allow a different password/username to overwrite a pending signup.
      const passwordMatches = await bcrypt.compare(
        password,
        user.password
      );

      if (
        user.username !== username ||
        !passwordMatches
      ) {
        return res.status(409).json({
          message:
            "An unverified signup already exists for this email. Use Resend OTP or finish verification.",
        });
      }
    } else {
      const hashedPassword = await bcrypt.hash(password, 12);

      user = new User({
        username,
        email,
        password: hashedPassword,
        isEmailVerified: false,
      });
    }

    const otpResult = await issueOtp(user);

    if (otpResult.error) {
      return res.status(429).json({ message: otpResult.error });
    }

    return res.status(200).json({
      success: true,
      message: "Verification code sent to your email.",
      requiresVerification: true,
      email,
    });
  } catch (error) {
    console.error("Signup error:", error.message);

    if (error.code === 11000) {
      return res.status(409).json({
        message: "Email or username is already registered.",
      });
    }

    return res.status(500).json({
      message: "Signup failed. Please try again.",
    });
  }
});

// VERIFY EMAIL OTP
router.post("/verify-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || "").trim();

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        message: "Enter the valid 6-digit OTP.",
      });
    }

    const user = await User.findOne({ email }).select(
      "+emailOtpHash +emailOtpExpires +emailOtpAttempts"
    );

    if (!user) {
      return res.status(400).json({
        message: "Invalid verification request. Please sign up again.",
      });
    }

    if (user.isEmailVerified === true) {
      return res.json({
        success: true,
        message: "Email is already verified. Please log in.",
      });
    }

    if (
      !user.emailOtpHash ||
      !user.emailOtpExpires ||
      new Date(user.emailOtpExpires).getTime() < Date.now()
    ) {
      return res.status(400).json({
        message: "OTP expired. Please request a new OTP.",
      });
    }

    if ((user.emailOtpAttempts || 0) >= 5) {
      user.emailOtpHash = undefined;
      user.emailOtpExpires = undefined;
      user.emailOtpAttempts = 0;
      await user.save();

      return res.status(429).json({
        message: "Too many incorrect attempts. Please request a new OTP.",
      });
    }

    user.emailOtpAttempts = (user.emailOtpAttempts || 0) + 1;

    const submittedHash = hashValue(otp);
    const storedHash = user.emailOtpHash;

    const matches =
      submittedHash.length === storedHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(submittedHash, "hex"),
        Buffer.from(storedHash, "hex")
      );

    if (!matches) {
      await user.save();

      return res.status(400).json({
        message: "Incorrect OTP. Please check your email and try again.",
      });
    }

    user.isEmailVerified = true;
    user.emailOtpHash = undefined;
    user.emailOtpExpires = undefined;
    user.emailOtpAttempts = 0;
    user.emailOtpLastSentAt = undefined;

    await user.save();

    return res.json({
      success: true,
      message: "Email verified successfully. Please log in.",
    });
  } catch (error) {
    console.error("OTP verification error:", error.message);
    return res.status(500).json({
      message: "Verification failed. Please try again.",
    });
  }
});

// RESEND OTP
router.post("/resend-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);

    const user = await User.findOne({ email }).select(
      "+emailOtpHash +emailOtpExpires +emailOtpAttempts +emailOtpLastSentAt"
    );

    if (!user || user.isEmailVerified === true) {
      return res.status(400).json({
        message: "No pending verification found. Please sign up or log in.",
      });
    }

    const otpResult = await issueOtp(user);

    if (otpResult.error) {
      return res.status(429).json({ message: otpResult.error });
    }

    return res.json({
      success: true,
      message: "A new verification code has been sent.",
    });
  } catch (error) {
    console.error("Resend OTP error:", error.message);
    return res.status(500).json({
      message: "Could not resend OTP. Please try again later.",
    });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({
        message: "Invalid email or password.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatches) {
      return res.status(400).json({
        message: "Invalid email or password.",
      });
    }

    // Old accounts without this field remain usable.
    if (user.isEmailVerified === false) {
      return res.status(403).json({
        message: "Please verify your email with the OTP sent to you.",
        requiresVerification: true,
        email: user.email,
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not configured.");
      return res.status(500).json({
        message: "Server configuration error.",
      });
    }

    const token = jwt.sign(
      { userId: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        profilePic: user.profilePic || "",
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({
      message: "Login failed. Please try again.",
    });
  }
});

// FORGOT PASSWORD
router.post("/forgot-password", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const user = await User.findOne({ email });

    const genericMessage =
      "If an account exists for that email, a password reset link will be sent.";

    if (!user) {
      return res.json({ message: genericMessage });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");

    user.resetPasswordToken = hashValue(rawToken);
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const clientUrl = (
      process.env.CLIENT_URL || "http://localhost:5173"
    ).replace(/\/+$/, "");

    const resetUrl = `${clientUrl}/reset-password?token=${rawToken}`;

    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: "ChatSpace Password Reset",
        text: `You requested a password reset.\n\nOpen this link to reset your password:\n${resetUrl}\n\nThis link expires in 15 minutes. If you did not request this, ignore this email.`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:24px">
            <h2>ChatSpace Password Reset</h2>
            <p>Use the link below to reset your password. It expires in 15 minutes.</p>
            <p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#8b5cf6;color:white;text-decoration:none;border-radius:8px">Reset Password</a></p>
            <p>If you did not request this, ignore this email.</p>
          </div>
        `,
      });
    } catch (mailError) {
      console.error("Password reset email error:", mailError.message);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      return res.status(500).json({
        message: "Could not send reset email. Please try again later.",
      });
    }

    return res.json({ message: genericMessage });
  } catch (error) {
    console.error("Forgot password error:", error.message);
    return res.status(500).json({
      message: "Could not process the request. Please try again.",
    });
  }
});

// RESET PASSWORD
router.post("/reset-password", async (req, res) => {
  try {
    const rawToken = String(req.body.token || "");
    const password = String(req.body.password || "");

    if (!rawToken || password.length < 6) {
      return res.status(400).json({
        message: "A valid reset token and password of at least 6 characters are required.",
      });
    }

    const hashedToken = hashValue(rawToken);

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        message: "Reset link is invalid or expired. Please request a new one.",
      });
    }

    user.password = await bcrypt.hash(password, 12);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    return res.json({
      success: true,
      message: "Password reset successful. Please log in.",
    });
  } catch (error) {
    console.error("Reset password error:", error.message);
    return res.status(500).json({
      message: "Could not reset password. Please try again.",
    });
  }
});

module.exports = router;