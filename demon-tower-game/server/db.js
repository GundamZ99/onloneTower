// db.js — SQLite persistence layer.
// ทุกอย่างที่เป็น "ความจริง" ของเกม (gold, exp, inventory) เก็บที่นี่
// ไม่ใช่ที่ client อีกต่อไป — client แค่ "ขอ" ให้ server เปลี่ยนค่า แล้ว server ตัดสินว่าทำได้ไหม
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'demon-tower.db'));
db.pragma('journal_mode = WAL');

// pass_hash/pass_salt เป็น NULL ได้ตอนนี้ — บัญชีที่สมัครผ่าน Google ไม่มีรหัสผ่านของเราเลย
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT,
  pass_salt TEXT,
  google_sub TEXT UNIQUE,
  email TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  name TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  hp INTEGER NOT NULL DEFAULT 100,
  max_hp INTEGER NOT NULL DEFAULT 100,
  atk INTEGER NOT NULL DEFAULT 10,
  mag INTEGER NOT NULL DEFAULT 10,
  luk INTEGER NOT NULL DEFAULT 10,
  gold INTEGER NOT NULL DEFAULT 0,
  exp INTEGER NOT NULL DEFAULT 0,
  floor_demon INTEGER NOT NULL DEFAULT 1,
  inventory_json TEXT NOT NULL DEFAULT '[]',
  deck_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
`);

// Migration เผื่อ DB เก่าที่ deploy ไว้แล้วก่อนเพิ่ม Google login (คอลัมน์ pass_hash/pass_salt
// เดิมเป็น NOT NULL, ยังไม่มี google_sub/email) — ALTER TABLE ทำแบบ "ลองแล้วเงียบถ้ามีอยู่แล้ว"
// เพราะ SQLite ไม่รองรับ "ADD COLUMN IF NOT EXISTS"
function tryAlter(sql) { try { db.exec(sql); } catch (e) { /* คอลัมน์มีอยู่แล้ว - ข้ามได้เลย */ } }
tryAlter('ALTER TABLE users ADD COLUMN google_sub TEXT');
tryAlter('ALTER TABLE users ADD COLUMN email TEXT');

// ---------- ระบบเพื่อน (friend list) ----------
// status: 'pending' = user_id ส่งคำขอไปหา friend_id แล้วรอตอบรับ, 'accepted' = เป็นเพื่อนกันแล้ว
// เก็บแถวเดียวต่อทิศทาง (user_id -> friend_id) ตอน accept จะ insert แถวกลับด้านด้วย
// เพื่อให้ query "เพื่อนของฉัน" จาก user_id ฝั่งไหนก็ได้ง่าย ๆ ด้วย WHERE user_id = ? เดียว
db.exec(`
CREATE TABLE IF NOT EXISTS friends (
  user_id INTEGER NOT NULL REFERENCES users(id),
  friend_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

-- ระบบบล็อกผู้เล่น: user_id บล็อก blocked_id ไว้ -> เป้าหมายจะขอเป็นเพื่อน/ท้าดวล/เชิญปาร์ตี้
-- กับ user_id ไม่ได้อีก (เช็คสองทิศทางฝั่งไหนบล็อกก็พอ)
CREATE TABLE IF NOT EXISTS blocks (
  user_id INTEGER NOT NULL REFERENCES users(id),
  blocked_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, blocked_id)
);

-- ระบบรายงานผู้เล่น (เก็บไว้ให้แอดมินตรวจสอบ; ต้องมีตาม policy ของ App Store/Play Store
-- สำหรับแอปที่มีการปฏิสัมพันธ์ระหว่างผู้ใช้ เช่น PvP/ระบบเพื่อน)
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reported_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);
`);

module.exports = db;

