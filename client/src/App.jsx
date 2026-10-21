
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const API = "http://10.122.150.44:5000/api";
const SERVER_URL = "http://10.122.150.44:5000";

const socket = io(SERVER_URL, {
  autoConnect: false,
  transports: ["polling", "websocket"],
});

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function displayUsername(username = "") {
  return String(username ?? "")
    .replace(/\b(?:online|offline)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}


function Avatar({ person, className = "", onClick }) {
  const picture = person?.profilePic;

  return (
    <span
      className={`avatar ${className} ${picture ? "avatar-clickable" : ""}`}
      onClick={picture ? onClick : undefined}
      role={picture ? "button" : undefined}
      tabIndex={picture ? 0 : undefined}
      title={picture ? "Open profile picture" : undefined}
      onKeyDown={(e) => {
        if (picture && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {picture ? (
        <img
          src={`${SERVER_URL}${picture}`}
          alt={`${displayUsername(person?.username) || "User"} profile`}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        displayUsername(person?.username).charAt(0).toUpperCase() || "U"
      )}
    </span>
  );
}

function App() {
  const [resetToken] = useState(
    () => new URLSearchParams(window.location.search).get("token") || ""
  );

  const [mode, setMode] = useState(() =>
    new URLSearchParams(window.location.search).get("token")
      ? "reset"
      : "login"
  );

  const [confirmPassword, setConfirmPassword] = useState("");
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("chatUser")) || null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState(
    () => localStorage.getItem("chatToken") || ""
  );
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [users, setUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const selectedUserRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadingPic, setUploadingPic] = useState(false);
  const [previewPic, setPreviewPic] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  const openProfilePicture = (person) => {
    if (!person?.profilePic) return;

    setPreviewPic({
      url: `${SERVER_URL}${person.profilePic}`,
      username: displayUsername(person.username) || "User",
    });
  };

  const submitAuth = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      let endpoint;
      let body;

      if (mode === "reset") {
        if (!resetToken) {
          throw new Error("Reset link missing. Request a new reset email.");
        }
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        endpoint = "/auth/reset-password";
        body = { token: resetToken, password };
      } else if (mode === "signup") {
        endpoint = "/auth/signup";
        body = { username: username.trim(), email: email.trim(), password };
      } else if (mode === "forgot") {
        endpoint = "/auth/forgot-password";
        body = { email: email.trim() };
      } else {
        endpoint = "/auth/login";
        body = { email: email.trim(), password };
      }

      const response = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Something went wrong.");
      }

      if (mode === "reset") {
        localStorage.removeItem("chatToken");
        localStorage.removeItem("chatUser");
        setToken("");
        setUser(null);
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        window.history.replaceState({}, "", window.location.pathname);
        setError("Password reset successful! Please log in.");
        return;
      }

      if (mode === "signup") {
        setMode("login");
        setPassword("");
        setError("Account created! Please log in.");
        return;
      }

      if (mode === "forgot") {
        setError(
          data.message ||
            "If the account exists, reset instructions will be sent."
        );
        setPassword("");
        return;
      }

      localStorage.setItem("chatToken", data.token);
      localStorage.setItem("chatUser", JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      setPassword("");
      setError("");
    } catch (err) {
      setError(err.message || "Unable to connect to the server.");
    } finally {
      setLoading(false);
    }
  };

  const uploadProfilePicture = async (file) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be smaller than 5 MB.");
      return;
    }

    if (!token) {
      setError("Please log in again.");
      return;
    }

    const formData = new FormData();
    formData.append("profilePic", file);

    try {
      setUploadingPic(true);
      setError("");

      const response = await fetch(`${API}/users/profile-picture`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Profile picture upload failed.");
      }

      const updatedUser = {
        ...user,
        ...data.user,
        profilePic: data.user?.profilePic || "",
      };

      setUser(updatedUser);
      localStorage.setItem("chatUser", JSON.stringify(updatedUser));
      setError("Profile picture updated successfully!");
    } catch (err) {
      setError(err.message || "Unable to upload profile picture.");
    } finally {
      setUploadingPic(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!user || !token) return;
    let cancelled = false;

    async function fetchUsers() {
      try {
        const response = await fetch(`${API}/users`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Unable to load users.");
        }

        if (!cancelled) setUsers(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    fetchUsers();
    return () => {
      cancelled = true;
    };
  }, [user, token]);

  useEffect(() => {
    if (!user || !token) return;

    socket.auth = { token };

    const handleConnect = () => {
      const selected = selectedUserRef.current;
      if (selected) {
        socket.emit("get_messages", { receiverId: selected._id });
      }
    };

    const handlePreviousMessages = (data) => {
      setMessages(Array.isArray(data) ? data : []);
    };

    const handleReceiveMessage = (data) => {
      const selected = selectedUserRef.current;
      if (!selected) return;

      const currentId = String(user._id);
      const senderId = String(data.sender);
      const receiverId = String(data.receiver);
      const selectedId = String(selected._id);

      const belongsToCurrentChat =
        (senderId === currentId && receiverId === selectedId) ||
        (senderId === selectedId && receiverId === currentId);

      if (belongsToCurrentChat) {
        setMessages((previous) => {
          if (previous.some((item) => item._id === data._id)) {
            return previous;
          }
          return [...previous, data];
        });
      }
    };

    const handleOnlineUsers = (ids) => {
      setOnlineUsers(Array.isArray(ids) ? ids.map(String) : []);
    };

    const handleUserOnline = (id) => {
      const userId = String(id);
      setOnlineUsers((previous) =>
        previous.includes(userId) ? previous : [...previous, userId]
      );
    };

    const handleUserOffline = (id) => {
      const userId = String(id);
      setOnlineUsers((previous) =>
        previous.filter((item) => item !== userId)
      );
    };

    const handleChatError = (text) => setError(text);
    const handleConnectError = (err) => {
      setError(`Connection error: ${err.message}`);
    };

    socket.on("connect", handleConnect);
    socket.on("previous_messages", handlePreviousMessages);
    socket.on("receive_message", handleReceiveMessage);
    socket.on("online_users", handleOnlineUsers);
    socket.on("user_online", handleUserOnline);
    socket.on("user_offline", handleUserOffline);
    socket.on("chat_error", handleChatError);
    socket.on("connect_error", handleConnectError);

    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("previous_messages", handlePreviousMessages);
      socket.off("receive_message", handleReceiveMessage);
      socket.off("online_users", handleOnlineUsers);
      socket.off("user_online", handleUserOnline);
      socket.off("user_offline", handleUserOffline);
      socket.off("chat_error", handleChatError);
      socket.off("connect_error", handleConnectError);
      socket.disconnect();
    };
  }, [user, token]);

  useEffect(() => {
    setMessages([]);
    setMessage("");
    setError("");

    if (selectedUser && socket.connected) {
      socket.emit("get_messages", { receiverId: selectedUser._id });
    }
  }, [selectedUser]);

  const chooseUser = (person) => setSelectedUser(person);

  const sendMessage = (e) => {
    e.preventDefault();
    const cleanMessage = message.trim();

    if (!cleanMessage || !selectedUser) return;

    if (!socket.connected) {
      setError("Connection lost. Reconnecting to chat...");
      socket.connect();
      return;
    }

    socket.emit("send_message", {
      receiverId: selectedUser._id,
      message: cleanMessage,
    });

    setMessage("");
    setError("");
  };

  const logout = () => {
    socket.disconnect();
    localStorage.removeItem("chatToken");
    localStorage.removeItem("chatUser");
    setToken("");
    setUser(null);
    setUsers([]);
    setSelectedUser(null);
    selectedUserRef.current = null;
    setMessages([]);
    setMessage("");
    setError("");
    setPreviewPic(null);
    setMode("login");
  };

  if (mode === "reset" || !user || !token) {
    return (
      <main className="app">
        <section className="chat auth-card">
          <header className="chat-header">
            <div className="avatar">C</div>
            <div>
              <h1>ChatSpace</h1>
              <p>Your conversations start here</p>
            </div>
          </header>

          <h2>
            {mode === "signup"
              ? "Create account"
              : mode === "forgot"
                ? "Forgot Password?"
                : mode === "reset"
                  ? "Reset Password"
                  : "Welcome back"}
          </h2>

          <p>
            {mode === "signup"
              ? "Join ChatSpace to get started."
              : mode === "forgot"
                ? "Enter your email to request a password reset link."
                : mode === "reset"
                  ? "Choose a new password for your account."
                  : "Log in to continue chatting."}
          </p>

          <form className="auth-form" onSubmit={submitAuth}>
            {mode === "signup" && (
              <label>
                Username
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username"
                  minLength={3}
                  maxLength={30}
                  required
                />
              </label>
            )}

            {mode !== "reset" && (
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </label>
            )}

            {mode !== "forgot" && (
              <label>
                {mode === "reset" ? "New password" : "Password"}
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  autoComplete={mode === "reset" ? "new-password" : "current-password"}
                  required
                />
              </label>
            )}

            {mode === "reset" && (
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Enter password again"
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
              </label>
            )}

            {error && <p className="auth-error" role="status">{error}</p>}

            <button type="submit" disabled={loading}>
              {loading
                ? "Please wait..."
                : mode === "signup"
                  ? "Create account"
                  : mode === "forgot"
                    ? "Send Reset Link"
                    : mode === "reset"
                      ? "Reset Password"
                      : "Log in"}
            </button>
          </form>

          {mode === "login" && (
            <p className="auth-switch">
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setMode("forgot");
                  setError("");
                  setPassword("");
                }}
              >
                Forgot Password?
              </button>
            </p>
          )}

          {mode !== "reset" && (
            <p className="auth-switch">
              {mode === "signup" || mode === "forgot"
                ? "Remembered your password? "
                : "New to ChatSpace? "}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setMode(
                    mode === "signup" || mode === "forgot" ? "login" : "signup"
                  );
                  setError("");
                  setPassword("");
                  setConfirmPassword("");
                }}
              >
                {mode === "signup" || mode === "forgot" ? "Log in" : "Sign up"}
              </button>
            </p>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="app">
      <section className="chat">
        <header className="chat-header">
          <Avatar person={user} onClick={() => openProfilePicture(user)} />

          <div className="chat-brand">
            <h1>ChatSpace</h1>
            <p>Logged in as {displayUsername(user.username)}</p>
          </div>

          <div className="profile-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => uploadProfilePicture(e.target.files?.[0])}
            />
            <button
              type="button"
              className="profile-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPic}
            >
              {uploadingPic ? "Uploading..." : "Change photo"}
            </button>
            <button type="button" onClick={logout}>Log out</button>
          </div>
        </header>

        {error && <p className="auth-error app-notice" role="status">{error}</p>}

        <div className="private-chat-layout">
          <aside className="user-list">
            <h3>People</h3>

            {users.length === 0 && (
              <p className="empty-users">
                No other users found. Create another account to test chat.
              </p>
            )}

            {users.map((person) => {
              const isOnline = onlineUsers.includes(String(person._id));

              return (
                <button
                  type="button"
                  key={person._id}
                  className={`user-item ${selectedUser?._id === person._id ? "active" : ""}`}
                  onClick={() => chooseUser(person)}
                >
                  <Avatar
                    person={person}
                    className="small"
                    onClick={() => openProfilePicture(person)}
                  />
                  <span className="user-info">
                    <span className="user-name">{displayUsername(person.username) || "User"}</span>
                    <span className="user-status">
                      <span className={`status-dot ${isOnline ? "online" : ""}`} />
                      {isOnline ? "Online" : "Offline"}
                    </span>
                  </span>
                </button>
              );
            })}
          </aside>

          <div className="conversation">
            {selectedUser ? (
              <>
                <div className="conversation-header">
                  <Avatar
                    person={selectedUser}
                    className="small"
                    onClick={() => openProfilePicture(selectedUser)}
                  />
                  <div>
                    <h3>{displayUsername(selectedUser.username)}</h3>
                    <p className="header-status">
                      <span className={`status-dot ${onlineUsers.includes(String(selectedUser._id)) ? "online" : ""}`} />
                      {onlineUsers.includes(String(selectedUser._id)) ? "Online" : "Offline"}
                    </p>
                  </div>
                </div>

                <div className="messages">
                  {messages.length === 0 && (
                    <div className="empty">
                      <span>ðŸ’¬</span>
                      <h2>Start a conversation</h2>
                      <p>Send your first private message below.</p>
                    </div>
                  )}

                  {messages.map((item, index) => {
                    const isMine = String(item.sender) === String(user._id);

                    return (
                      <div
                        className={`message ${isMine ? "my-message" : ""}`}
                        key={item._id || `${item.timestamp}-${index}`}
                      >
                        <strong>{isMine ? "You" : displayUsername(selectedUser.username)}</strong>
                        <p>{item.message}</p>
                        <small>{formatTime(item.timestamp)}</small>
                      </div>
                    );
                  })}
                </div>

                <form className="message-form" onSubmit={sendMessage}>
                  <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Type a private message..."
                    aria-label="Message"
                    maxLength={2000}
                  />
                  <button type="submit" disabled={!message.trim()}>Send</button>
                </form>
              </>
            ) : (
              <div className="empty">
                <span>ðŸ’¬</span>
                <h2>Select a person</h2>
                <p>Choose someone from the list to start chatting.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {previewPic && (
        <div
          className="photo-viewer"
          onClick={() => setPreviewPic(null)}
          role="presentation"
        >
          <button
            type="button"
            className="photo-close"
            aria-label="Close profile picture"
            onClick={() => setPreviewPic(null)}
          >
            Ã—
          </button>

          <div
            className="photo-viewer-content"
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <img src={previewPic.url} alt={`${previewPic.username}'s profile`} />
            <p>{previewPic.username}</p>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;

