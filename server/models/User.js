
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    password: {
      type: String,
      required: true,
    },
    profilePic: {
    type: String,
    default: ""
    },

    // Forgot Password fields
    resetPasswordToken: {
      type: String,
      default: undefined,
    },

    resetPasswordExpires: {
      type: Date,
      default: undefined,
    },
  },
  { timestamps: true }
  
);

module.exports = mongoose.model("User", userSchema);
