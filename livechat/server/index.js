const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../client")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-memory storage
const users = new Map();      // nick -> { ws, lastSeen }
const messages = new Map();   // chatKey -> [msg, ...]
const allUsers = new Set();   // all registered nicks

function chatKey(a, b) {
  return [a, b].sort().join("__");
}

function broadcast(data) {
  const str = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
}

function sendTo(nick, data) {
  const user = users.get(nick);
  if (user && user.ws.readyState === WebSocket.OPEN) {
    user.ws.send(JSON.stringify(data));
  }
}

wss.on("connection", (ws) => {
  let myNick = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "login") {
      const nick = String(msg.nick).trim().replace(/\s+/g, "_");
      if (!nick || nick.length < 2 || nick.length > 20) {
        ws.send(JSON.stringify({ type: "error", text: "Неверный ник (2–20 символов)" }));
        return;
      }
      if (users.has(nick)) {
        ws.send(JSON.stringify({ type: "error", text: "Ник уже занят, выберите другой" }));
        return;
      }
      myNick = nick;
      allUsers.add(nick);
      users.set(nick, { ws, lastSeen: Date.now() });

      ws.send(JSON.stringify({ type: "logged_in", nick, users: [...allUsers] }));
      broadcast({ type: "user_list", users: [...allUsers] });
      broadcast({ type: "user_online", nick });

      console.log(`[+] ${nick} connected (${users.size} online)`);
    }

    else if (msg.type === "search") {
      const q = String(msg.query || "").toLowerCase().trim();
      const results = [...allUsers].filter(u => u !== myNick && u.toLowerCase().includes(q));
      ws.send(JSON.stringify({ type: "search_results", results }));
    }

    else if (msg.type === "get_history") {
      const key = chatKey(myNick, msg.with);
      const hist = messages.get(key) || [];
      ws.send(JSON.stringify({ type: "history", with: msg.with, messages: hist }));
    }

    else if (msg.type === "send_message") {
      if (!myNick || !msg.to || !msg.text) return;
      const text = String(msg.text).trim().slice(0, 2000);
      if (!text) return;

      const key = chatKey(myNick, msg.to);
      if (!messages.has(key)) messages.set(key, []);
      const record = { from: myNick, to: msg.to, text, time: new Date().toISOString() };
      messages.get(key).push(record);

      // Send to both sender and recipient
      ws.send(JSON.stringify({ type: "new_message", message: record }));
      sendTo(msg.to, JSON.stringify({ type: "new_message", message: record }));

      console.log(`[msg] ${myNick} → ${msg.to}: ${text.slice(0, 40)}`);
    }

    else if (msg.type === "typing") {
      sendTo(msg.to, JSON.stringify({ type: "typing", from: myNick }));
    }
  });

  ws.on("close", () => {
    if (myNick) {
      users.delete(myNick);
      broadcast({ type: "user_offline", nick: myNick });
      console.log(`[-] ${myNick} disconnected`);
    }
  });

  ws.on("error", () => {
    if (myNick) users.delete(myNick);
  });
});

// API: список пользователей
app.get("/api/users", (req, res) => {
  res.json({ users: [...allUsers], online: [...users.keys()] });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 LiveChat server running on port ${PORT}`);
  console.log(`   Open: http://localhost:${PORT}\n`);
});
