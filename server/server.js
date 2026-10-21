
require("dns").setServers(["8.8.8.8", "8.8.4.4"]);
require("dotenv").config();

const multer = require("multer");
const path = require("path");
const fs = require("fs");

const express = require("express");
const http = require("http");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const Message = require("./models/Message");
const User = require("./models/User");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");

const app = express();
const server = http.createServer(app);
const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() + "-" + Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);

    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
}));

app.use(express.json());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["polling", "websocket"],
});
app.get("/", (req, res) => {
  res.json({ message: "Chat server is running!" });
});

const authenticateProfileUpload = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      message: "Please log in first",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded.userId) {
      return res.status(401).json({
        message: "Invalid authentication token",
      });
    }

    req.profileUserId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};

app.post(
  "/api/users/profile-picture",
  authenticateProfileUpload,
  (req, res) => {
    upload.single("profilePic")(req, res, async (err) => {
      try {
        if (err) {
          return res.status(400).json({
            message: err.message,
          });
        }

        if (!req.file) {
          return res.status(400).json({
            message: "Please select an image",
          });
        }

        const user = await User.findByIdAndUpdate(
          req.profileUserId,
          {
            profilePic: `/uploads/${req.file.filename}`,
          },
          {
            new: true,
            runValidators: true,
          }
        ).select("-password");

        if (!user) {
          return res.status(404).json({
            message: "User not found",
          });
        }

        res.json({
          message: "Profile picture updated successfully",
          user,
        });
      } catch (error) {
        console.error("Profile upload failed:", error.message);

        res.status(500).json({
          message: "Failed to update profile picture",
        });
      }
    });
  }
);


// Verify JWT before allowing a socket connection
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Authentication token required"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("_id username");

    if (!user) {
      return next(new Error("User not found"));
    }

    socket.user = user;
    next();
  } catch (error) {
    next(new Error("Invalid or expired token"));
  }
});
// Track active connections for each user
const onlineUsers = new Map();

// Authenticated private chat

io.on("connection", (socket) => {
  const currentUserId = socket.user._id.toString();

  
  
  // Each user joins their own private room
  socket.join(currentUserId);
    console.log("Authenticated user connected:", socket.user.username);

  // Track this user's active socket connections
  let userSockets = onlineUsers.get(currentUserId);
  const wasOffline = !userSockets || userSockets.size === 0;

  if (!userSockets) {
    userSockets = new Set();
    onlineUsers.set(currentUserId, userSockets);
  }

  userSockets.add(socket.id);

  // Notify everyone when this user comes online
  if (wasOffline) {
    io.emit("user_online", currentUserId);
    console.log("ONLINE EVENT:", currentUserId);
  }

  // Send current online users to this connection
  socket.emit("online_users", Array.from(onlineUsers.keys()));

  console.log("Authenticated user connected:", socket.user.username);


  // Load conversation with the selected recipient
  socket.on("get_messages", async (data = {}) => {
    try {
      const receiverId = String(data.receiverId || "");

      if (!mongoose.isValidObjectId(receiverId)) {
        return socket.emit("chat_error", "Please select a valid user.");
      }

      const receiver = await User.findById(receiverId).select("_id");

      if (!receiver) {
        return socket.emit("chat_error", "User not found.");
      }

      const messages = await Message.find({
        $or: [
          { sender: currentUserId, receiver: receiverId },
          { sender: receiverId, receiver: currentUserId },
        ],
      })
        .sort({ timestamp: 1 })
        .limit(200)
        .lean();

      socket.emit("previous_messages", messages);
    } catch (error) {
      console.error("Loading private messages failed:", error.message);
      socket.emit("chat_error", "Unable to load messages.");
    }
  });

  // Save and deliver a message only to sender and recipient
  socket.on("send_message", async (data = {}) => {
    console.log("SEND MESSAGE RECEIVED:", data);
    try {
      const receiverId = String(data.receiverId || "");
      const message = String(data.message || "").trim();

      if (
        !mongoose.isValidObjectId(receiverId) ||
        receiverId === currentUserId ||
        !message ||
        message.length > 2000
      ) {
        return socket.emit("chat_error", "Invalid message or recipient.");
      }

      const receiver = await User.findById(receiverId).select("_id");

      if (!receiver) {
        return socket.emit("chat_error", "Recipient not found.");
      }

      const savedMessage = await Message.create({
        sender: socket.user._id,
        receiver: receiver._id,
        message,
      });

      const payload = {
        _id: savedMessage._id,
        sender: currentUserId,
        receiver: receiverId,
        message: savedMessage.message,
        timestamp: savedMessage.timestamp,
      };

      // Deliver only to the sender and the intended recipient
      io.to(currentUserId).emit("receive_message", payload);
      io.to(receiverId).emit("receive_message", payload);
      
    } catch (error) {
      console.error("Sending private message failed:", error.message);
      socket.emit("chat_error", "Unable to send message.");
    }
  });

  
socket.on("disconnect", () => {
  const userSockets = onlineUsers.get(currentUserId);

  if (userSockets) {
    userSockets.delete(socket.id);

    if (userSockets.size === 0) {
      onlineUsers.delete(currentUserId);
      io.emit("user_offline", currentUserId);
      console.log("OFFLINE EVENT:", currentUserId);
    }
  }


  console.log("User disconnected:", socket.user.username);
});
});


   

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing from .env");
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing from .env");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected successfully!");

    server.listen(PORT,"0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}


startServer();
