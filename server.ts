import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- SQLite Database Initialization ---
const db = new Database("foodbridge.db");

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    name TEXT,
    role TEXT,
    isVerified INTEGER DEFAULT 1,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    donorId TEXT,
    donorName TEXT,
    foodName TEXT,
    quantity TEXT,
    expiryTime TEXT,
    location TEXT,
    status TEXT,
    ngoId TEXT,
    ngoName TEXT,
    volunteerId TEXT,
    volunteerName TEXT,
    deliveryOtp TEXT,
    createdAt TEXT,
    FOREIGN KEY(donorId) REFERENCES users(uid)
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- Auth Routes ---
  app.post("/api/auth/register", (req, res) => {
    const { email, name, role } = req.body;
    try {
      const uid = Math.random().toString(36).substring(7);
      const createdAt = new Date().toISOString();
      const insert = db.prepare("INSERT INTO users (uid, email, name, role, createdAt) VALUES (?, ?, ?, ?, ?)");
      insert.run(uid, email, name, role, createdAt);
      
      const user = db.prepare("SELECT * FROM users WHERE uid = ?").get(uid);
      res.json(user);
    } catch (err: any) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "Email already registered" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    const { email } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) return res.status(401).json({ error: "Account not found" });
    res.json(user);
  });

  app.get("/api/auth/users", (req, res) => {
    // Basic protection: usually checking a session or token would happen here
    const rows = db.prepare("SELECT * FROM users ORDER BY createdAt DESC").all();
    res.json(rows);
  });

  // --- Listing Routes ---
  app.get("/api/listings", (req, res) => {
    const rows = db.prepare("SELECT * FROM listings ORDER BY createdAt DESC").all();
    res.json(rows);
  });

  app.post("/api/listings", (req, res) => {
    const { donorId, donorName, foodName, quantity, expiryTime, location, status } = req.body;
    const id = Math.random().toString(36).substring(7);
    const createdAt = new Date().toISOString();
    
    const insert = db.prepare(`
      INSERT INTO listings (id, donorId, donorName, foodName, quantity, expiryTime, location, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(id, donorId, donorName, foodName, quantity, expiryTime, location, status, createdAt);
    
    res.json({ id, ...req.body, createdAt });
  });

  app.patch("/api/listings/:id", (req, res) => {
    const { id } = req.params;
    const current = db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as any;
    if (!current) return res.status(404).json({ error: "Not found" });
    
    const updateBody = req.body;

    // Logic for Delivery OTP
    if (current.status === 'AVAILABLE' && updateBody.status === 'CLAIMED') {
      updateBody.deliveryOtp = Math.floor(100000 + Math.random() * 900000).toString();
    }

    // Logic for Delivery Verification
    if (updateBody.status === 'DELIVERED') {
      if (!updateBody.otpVerify || updateBody.otpVerify !== current.deliveryOtp) {
        return res.status(403).json({ error: "Invalid Delivery OTP. Please ask the NGO for the correct 6-digit code." });
      }
      delete updateBody.otpVerify; 
    }

    const finalKeys = Object.keys(updateBody);
    const finalValues = Object.values(updateBody);

    const sets = finalKeys.map(k => `${k} = ?`).join(", ");
    const update = db.prepare(`UPDATE listings SET ${sets} WHERE id = ?`);
    update.run(...finalValues, id);
    
    const updated = db.prepare("SELECT * FROM listings WHERE id = ?").get(id);
    res.json(updated);
  });

  app.delete("/api/listings/:id", (req, res) => {
    db.prepare("DELETE FROM listings WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // --- Background Task: Automatic Expiry to Manure ---
  setInterval(() => {
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE listings 
      SET status = 'EXPIRED_TO_MANURE' 
      WHERE status IN ('AVAILABLE', 'CLAIMED') 
      AND expiryTime < ?
    `).run(now);
    
    if (result.changes > 0) {
      console.log(`[System] ${result.changes} items expired and sent to manure processing.`);
    }
  }, 10000); // Check every 10 seconds for demo responsiveness

  // Vite middleware for development and static serving for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
