// db.js — SQLite persistence layer.
// ทุกอย่างที่เป็น "ความจริง" ของเกม (gold, exp, inventory) เก็บที่นี่
// ไม่ใช่ที่ client อีกต่อไป — client แค่ "ขอ" ให้ server เปลี่ยนค่า แล้ว server ตัดสินว่าทำได้ไหม
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'demon-tower.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  pass_salt TEXT NOT NULL,
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

module.exports = db;
